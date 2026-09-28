export type Status = 'todo' | 'doing' | 'done'

/**
 * Tasks live in one flat array. A task's children are the tasks whose
 * `parentId` points at it, and siblings are ordered by their relative
 * position in the array (manual order).
 */
export interface Task {
  id: string
  text: string
  notes: string
  tags: string[]
  status: Status
  parentId: string | null
  collapsed: boolean
  createdAt: number
  completedAt: number | null
}

export interface Row {
  task: Task
  depth: number
  hasChildren: boolean
  /** For each level from 1..depth: is the ancestor (or the task itself, last entry) the last of its siblings? */
  lastPath: boolean[]
}
