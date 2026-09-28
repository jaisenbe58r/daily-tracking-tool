import type { Row, Task } from './types'

export function newTask(parentId: string | null = null, text = ''): Task {
  return {
    id: crypto.randomUUID(),
    text,
    notes: '',
    tags: [],
    status: 'todo',
    parentId,
    collapsed: false,
    createdAt: Date.now(),
    completedAt: null,
    due: null,
    priority: false,
  }
}

export function childrenOf(tasks: Task[], parentId: string | null): Task[] {
  return tasks.filter((t) => t.parentId === parentId)
}

export function hasChildren(tasks: Task[], id: string): boolean {
  return tasks.some((t) => t.parentId === id)
}

function siblings(tasks: Task[], id: string): Task[] {
  const task = tasks.find((t) => t.id === id)
  return task ? childrenOf(tasks, task.parentId) : []
}

export function prevSibling(tasks: Task[], id: string): Task | undefined {
  const sibs = siblings(tasks, id)
  return sibs[sibs.findIndex((t) => t.id === id) - 1]
}

export function nextSibling(tasks: Task[], id: string): Task | undefined {
  const sibs = siblings(tasks, id)
  const i = sibs.findIndex((t) => t.id === id)
  return i < 0 ? undefined : sibs[i + 1]
}

export function descendantIds(tasks: Task[], id: string): Set<string> {
  const out = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const t of tasks) {
      if (t.parentId === cur && !out.has(t.id)) {
        out.add(t.id)
        stack.push(t.id)
      }
    }
  }
  return out
}

/** Depth-first list of rows, skipping the children of collapsed tasks. */
export function flatten(tasks: Task[]): Row[] {
  const byParent = new Map<string | null, Task[]>()
  for (const t of tasks) {
    const list = byParent.get(t.parentId) ?? []
    list.push(t)
    byParent.set(t.parentId, list)
  }
  const rows: Row[] = []
  const walk = (parentId: string | null, depth: number, lastPath: boolean[]) => {
    const kids = byParent.get(parentId) ?? []
    kids.forEach((task, i) => {
      const children = byParent.get(task.id) ?? []
      const path = depth === 0 ? [] : [...lastPath, i === kids.length - 1]
      rows.push({ task, depth, hasChildren: children.length > 0, lastPath: path })
      if (!task.collapsed) walk(task.id, depth + 1, path)
    })
  }
  walk(null, 0, [])
  return rows
}

/**
 * Moves (or inserts) `task` under `parentId`, right before `beforeId`.
 * With `beforeId` null it becomes the last child.
 */
export function place(tasks: Task[], task: Task, parentId: string | null, beforeId: string | null): Task[] {
  const moved = { ...task, parentId }
  const rest = tasks.filter((t) => t.id !== task.id)
  let index: number
  if (beforeId) {
    index = rest.findIndex((t) => t.id === beforeId)
  } else {
    const sibs = rest.filter((t) => t.parentId === parentId)
    index = sibs.length ? rest.indexOf(sibs[sibs.length - 1]) + 1 : rest.length
  }
  if (index < 0) index = rest.length
  return [...rest.slice(0, index), moved, ...rest.slice(index)]
}

export function update(tasks: Task[], id: string, patch: Partial<Task>): Task[] {
  return tasks.map((t) => (t.id === id ? { ...t, ...patch } : t))
}

/** New task after `id`: first child when `id` is an expanded parent, next sibling otherwise. */
export function insertAfter(tasks: Task[], id: string, created: Task): Task[] {
  const target = tasks.find((t) => t.id === id)
  if (!target) return [...tasks, created]
  const kids = childrenOf(tasks, id)
  if (kids.length && !target.collapsed) {
    return place(tasks, created, id, kids[0].id)
  }
  return place(tasks, created, target.parentId, nextSibling(tasks, id)?.id ?? null)
}

export function indent(tasks: Task[], id: string): Task[] {
  const task = tasks.find((t) => t.id === id)
  const prev = prevSibling(tasks, id)
  if (!task || !prev) return tasks
  return place(update(tasks, prev.id, { collapsed: false }), task, prev.id, null)
}

export function outdent(tasks: Task[], id: string): Task[] {
  const task = tasks.find((t) => t.id === id)
  const parent = task && tasks.find((t) => t.id === task.parentId)
  if (!task || !parent) return tasks
  return place(tasks, task, parent.parentId, nextSibling(tasks, parent.id)?.id ?? null)
}

export function moveUp(tasks: Task[], id: string): Task[] {
  const task = tasks.find((t) => t.id === id)
  const prev = prevSibling(tasks, id)
  if (!task || !prev) return tasks
  return place(tasks, task, task.parentId, prev.id)
}

export function moveDown(tasks: Task[], id: string): Task[] {
  const task = tasks.find((t) => t.id === id)
  const next = nextSibling(tasks, id)
  if (!task || !next) return tasks
  return place(tasks, task, task.parentId, nextSibling(tasks, next.id)?.id ?? null)
}

/** Removes a task; its children move up and take its place. */
export function remove(tasks: Task[], id: string): Task[] {
  const task = tasks.find((t) => t.id === id)
  if (!task) return tasks
  let out = tasks
  for (const child of childrenOf(tasks, id)) {
    out = place(out, child, task.parentId, id)
  }
  return out.filter((t) => t.id !== id)
}

/** Moves a task (with its subtree) to a new position; refuses to drop it inside itself. */
export function moveTo(tasks: Task[], id: string, parentId: string | null, beforeId: string | null): Task[] {
  const task = tasks.find((t) => t.id === id)
  if (!task || beforeId === id) return tasks
  if (parentId === id || (parentId && descendantIds(tasks, id).has(parentId))) return tasks
  return place(tasks, task, parentId, beforeId)
}
