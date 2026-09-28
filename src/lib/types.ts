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
  /** Local date (YYYY-MM-DD) the task is planned for; drives the Today view. */
  due: string | null
  priority: boolean
}

export interface Row {
  task: Task
  depth: number
  hasChildren: boolean
  /** For each level from 1..depth: is the ancestor (or the task itself, last entry) the last of its siblings? */
  lastPath: boolean[]
  /** Parent path shown when the row is out of its tree (grouped views, board). */
  context?: string
  /** Shown only because a descendant matches the filter. */
  dimmed?: boolean
}

export type SortMode = 'manual' | 'date' | 'status' | 'tag'

export interface Filters {
  tag: string | null
  hideDone: boolean
  /** Only what's planned for today or overdue, plus what got done today. */
  today: boolean
  /** Instant search (Cmd/Ctrl+F) over text, notes and tags. Not remembered between visits. */
  query: string
}

export interface Group {
  key: string
  label: string
  /** What a task created inside this group inherits. */
  inherit: Inherit
  rows: Row[]
}

/** Attributes a new task takes from where it was created (a group, an active filter). */
export type Inherit = Partial<Pick<Task, 'status' | 'tags' | 'due'>>
