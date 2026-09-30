/**
 * Posponer: a task leaves the sheet (with its subtasks) until a date, and
 * comes back at the top that day with a quiet ↩ mark. "Esperando" is the same
 * thing plus the #esperando tag, for what depends on someone else.
 */

import { dateKey, fold, resolveDate } from './parse'
import type { Task } from './types'

export const WAITING_TAG = 'esperando'

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const atNoon = (day: string) => new Date(`${day}T12:00`)

/** `n` working days after `from` (Saturdays and Sundays skipped). */
export function workingDaysAhead(from: Date, n: number): string {
  let d = from
  for (let left = n; left > 0; ) {
    d = addDays(d, 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) left--
  }
  return dateKey(d)
}

/** "mañana", "lunes", "15/10", "3 días", "2 semanas": a future date, or null. */
export function resolveSnooze(phrase: string, now: Date): string | null {
  const p = fold(phrase.trim())
  const span = p.match(/^(?:en\s+)?(\d{1,3})\s*(d|dias?|s|sem|semanas?)$/)
  if (span) {
    const n = Number(span[1])
    return n > 0 ? dateKey(addDays(now, span[2].startsWith('s') ? n * 7 : n)) : null
  }
  if (p === 'proxima semana' || p === 'semana que viene') return nextMonday(now)
  const day = resolveDate(p.replace(/^(?:el|hasta|hasta el)\s+/, ''), now)
  return day && day > dateKey(now) ? day : null
}

function nextMonday(now: Date): string {
  return dateKey(addDays(now, (8 - now.getDay()) % 7 || 7))
}

export interface SnoozeChoice {
  label: string
  until: string
}

/** The usual picks, in order. Esperando starts with three working days, the usual wait for a reply. */
export function snoozeChoices(now: Date, waiting: boolean): SnoozeChoice[] {
  const picks: SnoozeChoice[] = [
    { label: 'Mañana', until: dateKey(addDays(now, 1)) },
    { label: 'Pasado mañana', until: dateKey(addDays(now, 2)) },
    { label: 'El lunes', until: nextMonday(now) },
    { label: 'En una semana', until: dateKey(addDays(now, 7)) },
  ]
  if (waiting) picks.unshift({ label: '3 días laborables', until: workingDaysAhead(now, 3) })
  const seen = new Set<string>()
  return picks.filter((c) => !seen.has(c.until) && seen.add(c.until))
}

/** True while the task itself is postponed to a later day. */
export const isSnoozed = (task: Task, today: string) => task.snooze !== null && task.snooze.until > today

/** True on the day a postponed task comes back (until the next day starts). */
export const isBack = (task: Task, today: string) => task.snooze !== null && task.snooze.until <= today

/** Whole days between postponing and coming back. */
export function daysAway(task: Task): number {
  if (!task.snooze) return 0
  return Math.max(1, Math.round((atNoon(task.snooze.until).getTime() - atNoon(task.snooze.since).getTime()) / 86_400_000))
}

/** Whole days since it was postponed: how long an answer has been awaited. */
export function daysWaiting(task: Task, today: string): number {
  if (!task.snooze) return 0
  return Math.max(1, Math.round((atNoon(today).getTime() - atNoon(task.snooze.since).getTime()) / 86_400_000))
}

/** The sheet without postponed tasks and their subtasks. Same array when nothing is postponed. */
export function hideSnoozed(tasks: Task[], today: string): Task[] {
  if (!tasks.some((t) => isSnoozed(t, today))) return tasks
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const hidden = (t: Task): boolean => isSnoozed(t, today) || (t.parentId !== null && hidden(byId.get(t.parentId) ?? t))
  return tasks.filter((t) => !hidden(t))
}

export const snoozedCount = (tasks: Task[], today: string) => tasks.filter((t) => isSnoozed(t, today)).length

/**
 * New day. Tasks whose date has come stay marked (they're back today) and
 * their top-level ones rise; marks from a day already seen are cleared.
 * `lastDay` is the previous day the sheet was opened.
 */
export function wake(tasks: Task[], today: string, lastDay: string | null): { tasks: Task[]; rising: Set<string> } {
  const rising = new Set<string>()
  let changed = false
  const out = tasks.map((t) => {
    if (!t.snooze || t.snooze.until > today) return t
    if (lastDay !== null && t.snooze.until <= lastDay) {
      changed = true
      return { ...t, snooze: null }
    }
    if (t.parentId === null) rising.add(t.id)
    return t
  })
  return { tasks: changed ? out : tasks, rising }
}
