import { parentPath } from './organize'
import { dateKey } from './parse'
import { wake } from './snooze'
import { childrenOf, flatten } from './tree'
import type { Task } from './types'

const startOfDay = (today: string) => new Date(`${today}T00:00`).getTime()

/** True for an open task written before today: it carries a quiet age mark. */
export function isStale(task: Task, today: string): boolean {
  return task.status !== 'done' && task.text.trim() !== '' && task.createdAt < startOfDay(today)
}

/** Whole days since the task was written ("3" for three days ago). */
export function ageInDays(task: Task, today: string): number {
  return Math.max(1, Math.ceil((startOfDay(today) - task.createdAt) / 86_400_000))
}

/**
 * First visit of a new day: postponed tasks whose day has come, then
 * top-level tasks still open from earlier days, move to the top of the sheet,
 * keeping their order and their subtasks. `lastDay` is the previous visit.
 */
export function carryOver(input: Task[], today: string, lastDay: string | null = null): Task[] {
  const { tasks, rising: back } = wake(input, today, lastDay)
  const stale = new Set(childrenOf(tasks, null).filter((t) => isStale(t, today) && !back.has(t.id)).map((t) => t.id))
  if (!back.size && !stale.size) return tasks
  const roots = childrenOf(tasks, null)
  const reordered = [
    ...roots.filter((t) => back.has(t.id)),
    ...roots.filter((t) => stale.has(t.id)),
    ...roots.filter((t) => !back.has(t.id) && !stale.has(t.id)),
  ]
  if (reordered.every((t, i) => t === roots[i])) return tasks
  // Roots are ordered by array position; the rest of the array keeps its own order.
  const others = tasks.filter((t) => t.parentId !== null)
  return [...reordered, ...others]
}

const longDate = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })

/** Markdown recap of the day for a stand-up or an email: what got done, what's in progress. */
export function dailySummary(tasks: Task[], today: string): string {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const ordered = flatten(tasks.map((t) => (t.collapsed ? { ...t, collapsed: false } : t))).map((r) => byId.get(r.task.id)!)
  const line = (t: Task) => {
    const path = parentPath(byId, t)
    const tags = t.tags.map((tag) => ` #${tag}`).join('')
    return `- ${t.text.trim()}${path ? ` _(${path})_` : ''}${tags}`
  }
  const done = ordered.filter((t) => t.status === 'done' && t.completedAt && dateKey(new Date(t.completedAt)) === today && t.text.trim())
  const doing = ordered.filter((t) => t.status === 'doing' && t.text.trim())
  const title = longDate.format(new Date(`${today}T12:00`))
  const parts = [`**${title[0].toUpperCase()}${title.slice(1)}**`]
  parts.push('', '**Hecho**', ...(done.length ? done.map(line) : ['- Nada cerrado todavía']))
  if (doing.length) parts.push('', '**En curso**', ...doing.map(line))
  return parts.join('\n')
}

/** A task and its subtasks as indented text, the same shape pasting understands. */
export function subtreeOutline(tasks: Task[], id: string): string {
  const lines: string[] = []
  const walk = (task: Task, depth: number) => {
    const tags = task.tags.map((t) => ` #${t}`).join('')
    lines.push(`${'\t'.repeat(depth)}${task.text.trim()}${tags}${task.priority ? ' !' : ''}`)
    for (const child of childrenOf(tasks, task.id)) walk(child, depth + 1)
  }
  const root = tasks.find((t) => t.id === id)
  if (root) walk(root, 0)
  return lines.join('\n')
}
