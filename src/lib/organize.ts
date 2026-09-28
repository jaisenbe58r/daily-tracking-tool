import type { Filters, Group, Row, SortMode, Status, Task } from './types'
import { flatten } from './tree'
import { dateKey } from './parse'

export const STATUS_LABEL: Record<Status, string> = { todo: 'Pendiente', doing: 'En curso', done: 'Hecha' }

/** Whether a task passes the active filters. `today` is the local YYYY-MM-DD. */
export function matches(task: Task, filters: Filters, today: string): boolean {
  if (filters.hideDone && task.status === 'done') return false
  if (filters.tag && !task.tags.includes(filters.tag)) return false
  if (filters.today) {
    const planned = task.status !== 'done' && task.due !== null && task.due <= today
    const doneToday = task.status === 'done' && task.completedAt !== null && dateKey(new Date(task.completedAt)) === today
    if (!planned && !doneToday) return false
  }
  return true
}

export function isFiltering(filters: Filters) {
  return filters.hideDone || filters.today || filters.tag !== null
}

/** What a new task needs so it stays visible under the active filters. */
export function inheritFromFilters(filters: Filters, today: string): Group['inherit'] {
  return { ...(filters.tag ? { tags: [filters.tag] } : {}), ...(filters.today ? { due: today } : {}) }
}

/** "Proyecto ZimVie › Validar torno 04" for a task's ancestors. */
export function parentPath(byId: Map<string, Task>, task: Task): string {
  const names: string[] = []
  for (let p = task.parentId ? byId.get(task.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
    names.unshift(p.text.trim() || 'Sin título')
  }
  return names.join(' › ')
}

/**
 * The manual tree, filtered: a task shows when it matches or when one of its
 * descendants does (then it's dimmed, kept only as context).
 */
function manualRows(tasks: Task[], filters: Filters, today: string): Row[] {
  if (!isFiltering(filters)) return flatten(tasks)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const keep = new Set<string>()
  for (const t of tasks) {
    if (!matches(t, filters, today)) continue
    for (let cur: Task | undefined = t; cur && !keep.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      keep.add(cur.id)
    }
  }
  // Filtering must reveal matches hidden under collapsed parents.
  const visible = tasks.filter((t) => keep.has(t.id)).map((t) => (t.collapsed ? { ...t, collapsed: false } : t))
  const original = new Map(tasks.map((t) => [t.id, t]))
  return flatten(visible).map((row) => ({ ...row, task: original.get(row.task.id)!, dimmed: !matches(row.task, filters, today) }))
}

const dayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })

function dayKey(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayLabel(ts: number, now: number) {
  const key = dayKey(ts)
  if (key === dayKey(now)) return 'Hoy'
  if (key === dayKey(now - 86_400_000)) return 'Ayer'
  const label = dayFmt.format(ts)
  return label[0].toUpperCase() + label.slice(1)
}

/**
 * Rows for the list view. Manual mode is the editable tree; the other modes
 * lay tasks out flat in groups, each row carrying its parent path.
 */
export function organize(tasks: Task[], mode: SortMode, filters: Filters, now = Date.now()): Group[] {
  const today = dateKey(new Date(now))
  if (mode === 'manual') {
    // New tasks inherit the filters so they don't vanish as soon as they're created.
    return [{ key: 'all', label: '', inherit: inheritFromFilters(filters, today), rows: manualRows(tasks, filters, today) }]
  }
  const byId = new Map(tasks.map((t) => [t.id, t]))

  // Manual (depth-first) order is the tie-breaker everywhere.
  const ordered = flatten(tasks.map((t) => (t.collapsed ? { ...t, collapsed: false } : t)))
    .map((r) => byId.get(r.task.id)!)
    .filter((t) => matches(t, filters, today))
  const row = (task: Task): Row => ({ task, depth: 0, hasChildren: false, lastPath: [], context: parentPath(byId, task) })

  const groups = new Map<string, Group>()
  const fromFilters = inheritFromFilters(filters, today)
  const add = (key: string, label: string, inherit: Group['inherit'], task: Task) => {
    const group = groups.get(key) ?? { key, label, inherit: { ...fromFilters, ...inherit }, rows: [] }
    group.rows.push(row(task))
    groups.set(key, group)
  }

  if (mode === 'status') {
    for (const status of ['doing', 'todo', 'done'] as Status[]) {
      for (const t of ordered) if (t.status === status) add(status, STATUS_LABEL[status], { status }, t)
    }
  } else if (mode === 'date') {
    const byDate = [...ordered].sort((a, b) => b.createdAt - a.createdAt)
    for (const t of byDate) add(dayKey(t.createdAt), dayLabel(t.createdAt, now), {}, t)
  } else {
    const tags = [...new Set(ordered.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b, 'es'))
    for (const tag of tags) for (const t of ordered) if (t.tags.includes(tag)) add(`#${tag}`, `#${tag}`, { tags: [tag] }, t)
    for (const t of ordered) if (!t.tags.length) add('none', 'Sin tag', {}, t)
  }
  // Priority first inside each group; the sort is stable, so the rest keeps its order.
  return [...groups.values()].map((g) => ({ ...g, rows: g.rows.sort((a, b) => Number(b.task.priority) - Number(a.task.priority)) }))
}

export function allTags(tasks: Task[]): string[] {
  return [...new Set(tasks.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b, 'es'))
}
