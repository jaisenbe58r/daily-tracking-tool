import { dateKey, resolveDate } from '../lib/parse'
import type { Task } from '../lib/types'
import type { LogEvent } from './log'

/**
 * The memory compiled from the sheet: every task is a source, and the pages
 * (projects, people, topics, days) are derived from them. Nothing here is
 * typed by hand, so the memory can never contradict the sheet.
 *
 * Page keys: `p:<task id>` project, `h:<name>` person, `t:<tag>` topic,
 * `d:<YYYY-MM-DD>` day, `panorama`.
 */
export type PageKey = string

export interface Memory {
  today: string
  /** Tasks with words in them. */
  tasks: Task[]
  byId: Map<string, Task>
  /** Top-level tasks with at least two subtasks: the user's projects. */
  projects: Task[]
  /** Tasks that are the work itself (project headings are containers, not work). */
  work: Task[]
  /** Pages each task belongs to. */
  keys: Map<string, PageKey[]>
  /** Tasks on each project, person and topic page. */
  index: Map<PageKey, Task[]>
  people: string[]
  tags: string[]
  /** The log plus what the sheet itself proves (creation and completion dates), oldest first. */
  events: LogEvent[]
  /** Mondays (YYYY-MM-DD) of the weeks the charts cover, oldest first. */
  weeks: string[]
}

export const MIN_PROJECT_CHILDREN = 2
const MENTION_RE = /(^|[\s(])@([\p{L}\p{N}_-]+)/gu

/** `@luis` in a task's text or notes, lower-cased. `@viernes` is a date, not a person. */
export function mentions(task: Pick<Task, 'text' | 'notes'>, now = new Date()): string[] {
  const out = new Set<string>()
  for (const m of `${task.text}\n${task.notes}`.matchAll(MENTION_RE)) {
    const name = m[2].toLowerCase()
    if (!resolveDate(name, now) && !/^\d/.test(name)) out.add(name)
  }
  return [...out]
}

export const dayOf = (ms: number) => dateKey(new Date(ms))
/** The day a task last moved: when it was closed, else when it was written. */
export const activeDay = (t: Task) => dayOf(t.completedAt ?? t.createdAt)

const utc = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / 86_400_000)
export const addDays = (day: string, n: number) => new Date(utc(day) + n * 86_400_000).toISOString().slice(0, 10)
export const mondayOf = (day: string) => addDays(day, -((new Date(utc(day)).getUTCDay() + 6) % 7))
/** Whole calendar days from writing a task to closing it. */
export const flight = (t: Task) => (t.completedAt === null ? 0 : daysBetween(dayOf(t.createdAt), dayOf(t.completedAt)))

export function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export function buildMemory(all: Task[], log: LogEvent[], now = new Date()): Memory {
  const today = dateKey(now)
  const tasks = all.filter((t) => t.text.trim())
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const children = new Map<string | null, Task[]>()
  for (const t of tasks) {
    const list = children.get(t.parentId) ?? []
    list.push(t)
    children.set(t.parentId, list)
  }
  const countBelow = (id: string): number => (children.get(id) ?? []).reduce((n, c) => n + 1 + countBelow(c.id), 0)
  const projects = (children.get(null) ?? []).filter((t) => countBelow(t.id) >= MIN_PROJECT_CHILDREN)
  const projectIds = new Set(projects.map((p) => p.id))

  const rootOf = (t: Task): Task => {
    let cur = t
    for (let p = byId.get(cur.parentId ?? ''); p; p = byId.get(p.parentId ?? '')) cur = p
    return cur
  }

  const keys = new Map<string, PageKey[]>()
  const index = new Map<PageKey, Task[]>()
  const people = new Set<string>()
  const tags = new Set<string>()
  for (const t of tasks) {
    const root = rootOf(t)
    const own: PageKey[] = []
    // A project's own heading isn't one of its tasks; its page is the project itself.
    if (projectIds.has(root.id) && root !== t) own.push(`p:${root.id}`)
    for (const h of mentions(t, now)) {
      people.add(h)
      own.push(`h:${h}`)
    }
    for (const g of t.tags) {
      tags.add(g)
      own.push(`t:${g}`)
    }
    keys.set(t.id, own)
    for (const k of own) {
      const list = index.get(k) ?? []
      list.push(t)
      index.set(k, list)
    }
  }

  // The sheet already proves when each task was written and closed; the log adds the rest.
  const logged = new Set(log.map((e) => `${e.id}:${e.kind}`))
  const events = [...log]
  for (const t of tasks) {
    if (!logged.has(`${t.id}:create`)) events.push({ at: t.createdAt, id: t.id, kind: 'create', text: t.text })
    if (t.completedAt !== null && !logged.has(`${t.id}:done`)) events.push({ at: t.completedAt, id: t.id, kind: 'done' })
  }
  events.sort((a, b) => a.at - b.at)

  // From the first week with activity (at most a year back, at least twelve weeks) to this week.
  const thisWeek = mondayOf(today)
  const first = tasks.length ? mondayOf(tasks.reduce((m, t) => (activeDay(t) < m ? activeDay(t) : m), today)) : thisWeek
  let start = first < addDays(thisWeek, -51 * 7) ? addDays(thisWeek, -51 * 7) : first
  if (start > addDays(thisWeek, -11 * 7)) start = addDays(thisWeek, -11 * 7)
  const weeks: string[] = []
  for (let w = start; w <= thisWeek; w = addDays(w, 7)) weeks.push(w)

  const byCount = (m: Set<string>, prefix: string) =>
    [...m].sort((a, b) => (index.get(prefix + b)?.length ?? 0) - (index.get(prefix + a)?.length ?? 0) || a.localeCompare(b))

  return {
    today,
    tasks,
    byId,
    projects: [...projects].sort((a, b) => (index.get(`p:${b.id}`)?.length ?? 0) - (index.get(`p:${a.id}`)?.length ?? 0)),
    work: tasks.filter((t) => !projectIds.has(t.id)),
    keys,
    index,
    people: byCount(people, 'h:'),
    tags: byCount(tags, 't:'),
    events,
    weeks,
  }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const dayFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
const longFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
const yearFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
const monthFmt = new Intl.DateTimeFormat('es-ES', { month: 'short', year: 'numeric' })
const asDate = (day: string) => new Date(`${day}T12:00`)
/** "3 oct" */
export const shortDay = (day: string) => dayFmt.format(asDate(day)).replace('.', '')
/** "viernes, 3 de octubre" */
export const longDay = (day: string) => longFmt.format(asDate(day)).replace(',', '')
export const yearDay = (day: string) => yearFmt.format(asDate(day)).replace('.', '')
export const monthName = (month: string) => monthFmt.format(asDate(`${month}-15`)).replace('.', '')
export const personName = (h: string) => capital(h)

export function pageName(mem: Memory, key: PageKey): string {
  if (key === 'panorama') return 'Panorama'
  const [kind, id] = [key.slice(0, 1), key.slice(2)]
  if (kind === 'p') return mem.byId.get(id)?.text.trim() ?? 'Proyecto'
  if (kind === 'h') return personName(id)
  if (kind === 't') return `#${id}`
  if (kind === 'd') return shortDay(id)
  return key
}

/** Pages that share the most tasks with `key`, most first. */
export function related(mem: Memory, key: PageKey, limit = 7): [PageKey, number][] {
  const counts = new Map<PageKey, number>()
  for (const t of mem.index.get(key) ?? []) for (const k of mem.keys.get(t.id) ?? []) if (k !== key) counts.set(k, (counts.get(k) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit)
}

export const weekOf = (mem: Memory, day: string) => mem.weeks.indexOf(mondayOf(day))

/** Counts per chart week of `tasks`, placed on `day(task)`. Days outside the range are left out. */
export function perWeek(mem: Memory, tasks: Task[], day: (t: Task) => string | null = activeDay): number[] {
  const out = new Array(mem.weeks.length).fill(0)
  for (const t of tasks) {
    const d = day(t)
    if (!d) continue
    const w = weekOf(mem, d)
    if (w >= 0) out[w]++
  }
  return out
}

export interface TramaRow {
  key: PageKey
  label: string
  tasks: Task[]
  counts: number[]
}

/** The page itself, then the pages it crosses most, each counted week by week. */
export function trama(mem: Memory, key: PageKey): TramaRow[] {
  const own = mem.index.get(key) ?? []
  const rows: TramaRow[] = [{ key, label: 'Todo', tasks: own, counts: [] }]
  for (const [k] of related(mem, key)) rows.push({ key: k, label: pageName(mem, k), tasks: own.filter((t) => mem.keys.get(t.id)?.includes(k)), counts: [] })
  for (const r of rows) r.counts = perWeek(mem, r.tasks)
  return rows
}

export interface Day {
  closed: Task[]
  /** Written that day and still open when it ended. */
  carried: Task[]
  started: Task[]
  snoozed: Task[]
  removed: string[]
}

export function day(mem: Memory, d: string): Day {
  const closed = mem.tasks.filter((t) => t.completedAt !== null && dayOf(t.completedAt) === d)
  const carried = mem.tasks.filter((t) => dayOf(t.createdAt) === d && (t.completedAt === null || dayOf(t.completedAt) > d))
  const on = mem.events.filter((e) => dayOf(e.at) === d)
  const pick = (kind: LogEvent['kind']) => [...new Set(on.filter((e) => e.kind === kind).map((e) => e.id))].flatMap((id) => mem.byId.get(id) ?? [])
  return {
    closed,
    carried,
    started: pick('doing'),
    snoozed: pick('snooze'),
    removed: on.filter((e) => e.kind === 'remove' && e.text).map((e) => e.text!),
  }
}

/**
 * Days that ended "Hoy a cero": something was planned for that day (due that
 * day or earlier and still open when it began) and all of it was closed by
 * its end. A day with nothing planned doesn't count, as in the sheet.
 */
export function zeroDays(mem: Memory): Set<string> {
  const planned = mem.work.filter((t) => t.due)
  const candidates = new Set(planned.flatMap((t) => (t.completedAt === null ? [] : [dayOf(t.completedAt)])))
  const out = new Set<string>()
  for (const d of candidates) {
    if (d > mem.today) continue
    const due = planned.filter((t) => t.due! <= d && dayOf(t.createdAt) <= d && (t.completedAt === null || dayOf(t.completedAt) >= d))
    if (due.length && due.every((t) => t.completedAt !== null && dayOf(t.completedAt) === d)) out.add(d)
  }
  return out
}

export interface Month {
  month: string
  closed: number
  highlights: Task[]
}

/** Month by month, newest first: how much was closed and the few tasks that stand out (long ones, ones with people). */
export function chronology(mem: Memory, key: PageKey, perMonth = 4): Month[] {
  const byMonth = new Map<string, Task[]>()
  for (const t of mem.index.get(key) ?? []) {
    if (t.completedAt === null) continue
    const m = dayOf(t.completedAt).slice(0, 7)
    byMonth.set(m, [...(byMonth.get(m) ?? []), t])
  }
  const weight = (t: Task) => flight(t) + (mem.keys.get(t.id)?.length ?? 0) * 2
  return [...byMonth]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, ts]) => ({ month, closed: ts.length, highlights: [...ts].sort((a, b) => weight(b) - weight(a)).slice(0, perMonth) }))
}

/** Where to land when opening the memory from a task: its project, else its first page, else the overview. */
export function pageFor(mem: Memory, taskId: string | null): PageKey {
  if (taskId && mem.projects.some((p) => p.id === taskId)) return `p:${taskId}`
  return (taskId && mem.keys.get(taskId)?.[0]) || 'panorama'
}
