import type { Repeat, Source, Status, Task } from './types'
import { newTask } from './tree'

export const STORAGE_KEY = 'daily-tracking-tool:v1'

const STATUSES: Status[] = ['todo', 'doing', 'done']
const REPEATS: Repeat[] = ['daily', 'weekdays', 'weekly', 'monthly']

/**
 * Turns whatever is in storage into a valid task list: fills missing fields,
 * drops duplicates and re-roots tasks whose parent no longer exists or that
 * form a cycle, so a bad write can never leave the sheet unusable.
 */
/** Tasks from mail or calendar. The first version kept the link in the notes; it moves out of the way. */
function readSource(r: Record<string, unknown>): Pick<Task, 'source'> & Partial<Pick<Task, 'notes'>> {
  const s = r.source as Partial<Source> | null | undefined
  if (s && (s.app === 'gmail' || s.app === 'calendar') && typeof s.url === 'string' && s.url.startsWith('https://')) return { source: { app: s.app, url: s.url } }
  const legacy = typeof r.notes === 'string' ? r.notes.match(/^(Gmail|Google Calendar) · [^\n]*\n(https:\/\/\S+)$/) : null
  if (legacy) return { source: { app: legacy[1] === 'Gmail' ? 'gmail' : 'calendar', url: legacy[2] }, notes: '' }
  return {}
}

export function sanitize(input: unknown): Task[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const tasks: Task[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (typeof r.id !== 'string' || seen.has(r.id)) continue
    seen.add(r.id)
    const status = STATUSES.includes(r.status as Status) ? (r.status as Status) : 'todo'
    tasks.push({
      id: r.id,
      text: typeof r.text === 'string' ? r.text : '',
      notes: typeof r.notes === 'string' ? r.notes : '',
      tags: Array.isArray(r.tags) ? [...new Set(r.tags.filter((t): t is string => typeof t === 'string'))] : [],
      status,
      parentId: typeof r.parentId === 'string' ? r.parentId : null,
      collapsed: r.collapsed === true,
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
      completedAt: status === 'done' && typeof r.completedAt === 'number' ? r.completedAt : null,
      due: typeof r.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.due) ? r.due : null,
      priority: r.priority === true,
      repeat: REPEATS.includes(r.repeat as Repeat) ? (r.repeat as Repeat) : null,
      ...readSource(r),
    })
  }
  const byId = new Map(tasks.map((t) => [t.id, t]))
  for (const task of tasks) {
    if (task.parentId && !byId.has(task.parentId)) task.parentId = null
    // Walk up; if we come back to this task, cut the loop here.
    const visited = new Set([task.id])
    for (let p = task.parentId; p; p = byId.get(p)?.parentId ?? null) {
      if (visited.has(p)) {
        task.parentId = null
        break
      }
      visited.add(p)
    }
  }
  return tasks
}

export function parse(raw: string | null): Task[] {
  if (!raw) return []
  try {
    return sanitize(JSON.parse(raw)?.tasks)
  } catch {
    return []
  }
}

export function load(): Task[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage blocked (private mode, policy): work in memory.
  }
  const tasks = parse(raw)
  return tasks.length ? tasks : [newTask()]
}

export function save(tasks: Task[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, tasks }))
    return true
  } catch {
    return false
  }
}
