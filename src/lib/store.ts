import { useEffect, useReducer } from 'react'
import type { Inherit, Repeat, Source, Status, Task } from './types'
import * as tree from './tree'
import { STORAGE_KEY, load, parse, save } from './persist'
import { dateKey, parseOutline, parseTask } from './parse'
import { carryOver } from './daily'
import { WAITING_TAG } from './snooze'
import { firstDue, plantNext } from './repeat'

export type Caret = number | 'start' | 'end'

export interface Focus {
  id: string
  target: 'text' | 'notes'
  caret: Caret
  /** Bumped on every request so the same row can be re-focused. */
  seq: number
}

export interface State {
  tasks: Task[]
  focus: Focus | null
}

interface History {
  past: Task[][]
  future: Task[][]
  /** `id:field` of the last text edit, so a burst of typing is one undo step. */
  typing: string | null
  /** The last change came from outside this tab's editing (another tab, an import): history doesn't log it. */
  external: boolean
}

export type AppState = State & History

export type Action =
  | { type: 'edit'; id: string; patch: Partial<Pick<Task, 'text' | 'notes' | 'tags'>> }
  | { type: 'commit'; id: string }
  /** `inherit` comes from the group the row sits in; `flat` keeps the new task a sibling (grouped views). */
  | { type: 'add-after'; id: string; inherit?: Inherit; flat?: boolean }
  | { type: 'create'; text: string; status: Status; inherit?: Inherit }
  /** Multi-line paste: one task per line, indentation as nesting, starting at `id`. */
  | { type: 'paste'; id: string; text: string; inherit?: Inherit }
  /** Links the task to a GitHub issue (or unlinks it); an empty task takes the issue's title. */
  | { type: 'link'; id: string; source: Source | null; title?: string }
  | { type: 'toggle-today'; id: string }
  | { type: 'toggle-priority'; id: string }
  /** Replaces everything (JSON import), as one undoable step. */
  | { type: 'import'; tasks: Task[] }
  /** New day: raise what's still open from earlier days. */
  | { type: 'carry-over'; today: string; lastDay?: string | null }
  /** Posponer until `until`; `waiting` also tags it #esperando. */
  | { type: 'snooze'; id: string; until: string; waiting?: boolean }
  | { type: 'unsnooze'; id: string }
  | { type: 'add-child'; id: string }
  | { type: 'add-end'; inherit?: Inherit }
  | { type: 'indent'; id: string; caret?: Caret }
  | { type: 'outdent'; id: string; caret?: Caret }
  | { type: 'move-up'; id: string; caret?: Caret }
  | { type: 'move-down'; id: string; caret?: Caret }
  | { type: 'move-to'; id: string; parentId: string | null; beforeId: string | null }
  | { type: 'set-status'; id: string; status: Status }
  | { type: 'toggle-done'; id: string }
  | { type: 'set-repeat'; id: string; repeat: Repeat | null }
  | { type: 'toggle-collapse'; id: string }
  | { type: 'remove'; id: string; focusPrev?: boolean }
  /** Several tasks at once (a row selection), one undo step. */
  | { type: 'remove-many'; ids: string[] }
  | { type: 'done-many'; ids: string[] }
  | { type: 'focus'; id: string; target?: Focus['target']; caret?: Caret }
  /** Opens every collapsed parent above the task, then focuses it (coming back from the memory). */
  | { type: 'reveal'; id: string }
  | { type: 'replace'; tasks: Task[] }
  /** A whole-sheet change proposed by the AI and accepted by the user: one undo step. */
  | { type: 'apply'; tasks: Task[] }
  | { type: 'undo' }
  | { type: 'redo' }

let seq = 0
const focusOn = (id: string, caret: Caret = 'end', target: Focus['target'] = 'text'): Focus => ({
  id,
  caret,
  target,
  seq: ++seq,
})

function withStatus(task: Task, status: Status): Partial<Task> {
  return { status, completedAt: status === 'done' ? (task.completedAt ?? Date.now()) : null }
}

/** Applies the quick-capture grammar (#tag, !, dates) to a task's text. */
function captured(task: Task): Task {
  const parsed = parseTask(task.text)
  if (parsed.text === task.text && !parsed.tags.length && !parsed.priority && !parsed.due && !parsed.repeat) return task
  return {
    ...task,
    text: parsed.text,
    tags: [...new Set([...task.tags, ...parsed.tags])],
    priority: task.priority || parsed.priority,
    due: parsed.due ?? task.due,
    repeat: parsed.repeat ?? task.repeat,
  }
}

function reducer(state: State, action: Exclude<Action, { type: 'undo' | 'redo' }>): State {
  const { tasks } = state
  const find = (id: string) => tasks.find((t) => t.id === id)

  switch (action.type) {
    case 'edit':
      return { ...state, tasks: tree.update(tasks, action.id, action.patch) }

    case 'link': {
      const task = find(action.id)
      if (!task) return state
      const text = !task.text.trim() && action.title ? action.title : task.text
      return { ...state, tasks: tree.update(tasks, task.id, { source: action.source, text }) }
    }

    case 'commit': {
      const task = find(action.id)
      if (!task) return state
      const next = captured(task)
      return next === task ? state : { ...state, tasks: tasks.map((t) => (t === task ? next : t)) }
    }

    case 'add-after': {
      const target = find(action.id)
      const created = { ...tree.newTask(), ...action.inherit }
      if (action.flat && target) {
        created.parentId = target.parentId
        const next = tree.nextSibling(tasks, target.id)
        return { tasks: tree.place(tasks, created, target.parentId, next?.id ?? null), focus: focusOn(created.id) }
      }
      return { tasks: tree.insertAfter(tasks, action.id, created), focus: focusOn(created.id) }
    }

    case 'create': {
      const created = captured({ ...tree.newTask(null, action.text.trim()), ...action.inherit })
      return { ...state, tasks: [...tasks, { ...created, ...withStatus(created, action.status) }] }
    }

    case 'paste': {
      const anchor = find(action.id)
      const items = parseOutline(action.text)
      if (!anchor || !items.length) return state
      let out = tasks
      // Top-level lines go right after the anchor, in order; deeper lines under the line above them.
      const before = tree.nextSibling(tasks, anchor.id)?.id ?? null
      const parents: string[] = []
      let last = anchor.id
      items.forEach((item, i) => {
        const fill = i === 0 && !anchor.text.trim()
        const base = fill ? anchor : { ...tree.newTask(), ...action.inherit }
        const depth = Math.min(item.depth, parents.length)
        const parentId = depth === 0 ? anchor.parentId : parents[depth - 1]
        let task = captured({ ...base, text: item.text, parentId })
        if (item.done) task = { ...task, ...withStatus(task, 'done') }
        out = fill ? out.map((t) => (t.id === anchor.id ? task : t)) : tree.place(out, task, parentId, depth === 0 ? before : null)
        parents.length = depth
        parents.push(task.id)
        last = task.id
      })
      return { tasks: out, focus: focusOn(last) }
    }

    case 'toggle-today': {
      const task = find(action.id)
      const today = dateKey(new Date())
      return task ? { ...state, tasks: tree.update(tasks, task.id, { due: task.due === today ? null : today }) } : state
    }

    case 'toggle-priority': {
      const task = find(action.id)
      return task ? { ...state, tasks: tree.update(tasks, task.id, { priority: !task.priority }) } : state
    }

    case 'carry-over':
      return { ...state, tasks: carryOver(tasks, action.today, action.lastDay ?? null) }

    case 'snooze': {
      const task = find(action.id)
      if (!task) return state
      const tags = action.waiting && !task.tags.includes(WAITING_TAG) ? [...task.tags, WAITING_TAG] : task.tags
      const next = tree.update(tasks, task.id, { snooze: { until: action.until, since: dateKey(new Date()) }, tags })
      return { ...state, tasks: next }
    }

    case 'unsnooze': {
      const task = find(action.id)
      return task?.snooze ? { ...state, tasks: tree.update(tasks, task.id, { snooze: null }) } : state
    }

    case 'import':
      return { tasks: action.tasks.length ? action.tasks : [tree.newTask()], focus: null }

    case 'add-child': {
      const created = tree.newTask(action.id)
      const firstChild = tree.childrenOf(tasks, action.id)[0]
      const expanded = tree.update(tasks, action.id, { collapsed: false })
      return { tasks: tree.place(expanded, created, action.id, firstChild?.id ?? null), focus: focusOn(created.id) }
    }

    case 'add-end': {
      const created = { ...tree.newTask(), ...action.inherit }
      return { tasks: [...tasks, created], focus: focusOn(created.id) }
    }

    case 'indent':
      return { tasks: tree.indent(tasks, action.id), focus: keepFocus(state, action.id, action.caret) }
    case 'outdent':
      return { tasks: tree.outdent(tasks, action.id), focus: keepFocus(state, action.id, action.caret) }
    case 'move-up':
      return { tasks: tree.moveUp(tasks, action.id), focus: keepFocus(state, action.id, action.caret) }
    case 'move-down':
      return { tasks: tree.moveDown(tasks, action.id), focus: keepFocus(state, action.id, action.caret) }
    case 'move-to':
      return { ...state, tasks: tree.moveTo(tasks, action.id, action.parentId, action.beforeId) }

    case 'set-status': {
      const task = find(action.id)
      if (!task) return state
      const next = tree.update(tasks, task.id, withStatus(task, action.status))
      return { ...state, tasks: action.status === 'done' && task.status !== 'done' ? plantNext(next, task.id, dateKey(new Date())) : next }
    }

    case 'toggle-done': {
      const task = find(action.id)
      if (!task) return state
      const status: Status = task.status === 'done' ? 'todo' : 'done'
      const next = tree.update(tasks, task.id, withStatus(task, status))
      return { ...state, tasks: status === 'done' ? plantNext(next, task.id, dateKey(new Date())) : next }
    }

    case 'set-repeat': {
      const task = find(action.id)
      if (!task || task.repeat === action.repeat) return state
      const due = action.repeat && !task.due ? firstDue(action.repeat, dateKey(new Date())) : task.due
      return { ...state, tasks: tree.update(tasks, task.id, { repeat: action.repeat, due }) }
    }

    case 'toggle-collapse': {
      const task = find(action.id)
      if (!task || !tree.hasChildren(tasks, task.id)) return state
      return { ...state, tasks: tree.update(tasks, task.id, { collapsed: !task.collapsed }) }
    }

    case 'remove': {
      const rows = tree.flatten(tasks)
      const i = rows.findIndex((r) => r.task.id === action.id)
      let next = tree.remove(tasks, action.id)
      if (!next.length) next = [tree.newTask()]
      const neighbour = rows[i - 1]?.task ?? rows[i + 1]?.task ?? next[0]
      return {
        tasks: next,
        focus: action.focusPrev === false ? null : focusOn(neighbour.id === action.id ? next[0].id : neighbour.id),
      }
    }

    case 'remove-many': {
      const gone = new Set(action.ids)
      const rows = tree.flatten(tasks)
      const first = rows.findIndex((r) => gone.has(r.task.id))
      let next = tasks
      for (const id of action.ids) next = tree.remove(next, id)
      if (next === tasks) return state
      if (!next.length) next = [tree.newTask()]
      const kept = new Set(next.map((t) => t.id))
      const neighbour = rows.slice(0, Math.max(first, 0)).reverse().find((r) => kept.has(r.task.id))?.task
        ?? rows.slice(first).find((r) => kept.has(r.task.id))?.task
        ?? next[0]
      return { tasks: next, focus: focusOn(neighbour.id) }
    }

    case 'done-many': {
      // All done already: reopen them all; otherwise close what's open.
      const picked = tasks.filter((t) => action.ids.includes(t.id))
      const status: Status = picked.every((t) => t.status === 'done') ? 'todo' : 'done'
      let next = tasks
      for (const task of picked) {
        if (task.status === status) continue
        next = tree.update(next, task.id, withStatus(task, status))
        if (status === 'done') next = plantNext(next, task.id, dateKey(new Date()))
      }
      return { ...state, tasks: next }
    }

    case 'focus':
      return { ...state, focus: focusOn(action.id, action.caret, action.target) }

    case 'reveal': {
      let out = tasks
      for (let p = find(action.id)?.parentId; p; p = out.find((t) => t.id === p)?.parentId) {
        if (out.find((t) => t.id === p)?.collapsed) out = tree.update(out, p, { collapsed: false })
      }
      return { tasks: out, focus: focusOn(action.id) }
    }

    case 'apply':
      return { ...state, tasks: action.tasks.length ? action.tasks : [tree.newTask()] }

    case 'replace':
      return { ...state, tasks: action.tasks.length ? action.tasks : [tree.newTask()] }
  }
}

function keepFocus(state: State, id: string, caret: Caret = 'end'): Focus {
  return focusOn(id, caret, state.focus?.id === id ? state.focus.target : 'text')
}

const HISTORY_LIMIT = 200

/** Wraps the reducer with undo/redo over the task list. Focus is not part of history. */
function withHistory(state: AppState, action: Action): AppState {
  if (action.type === 'undo' || action.type === 'redo') {
    const [from, to] = action.type === 'undo' ? (['past', 'future'] as const) : (['future', 'past'] as const)
    const snapshot = state[from].at(-1)
    if (!snapshot) return state
    return {
      ...state,
      tasks: snapshot,
      [from]: state[from].slice(0, -1),
      [to]: [...state[to], state.tasks],
      typing: null,
      external: false,
      focus: restoreFocus(state, snapshot),
    }
  }
  const next = reducer(state, action)
  if (action.type === 'replace') return { ...next, past: [], future: [], typing: null, external: true }
  if (next.tasks === state.tasks) return { ...state, ...next, typing: action.type === 'focus' ? null : state.typing }

  const typing = action.type === 'edit' ? `${action.id}:${Object.keys(action.patch).join()}` : null
  const coalesce = typing !== null && typing === state.typing
  return {
    ...next,
    past: coalesce ? state.past : [...state.past, state.tasks].slice(-HISTORY_LIMIT),
    future: [],
    typing,
    external: action.type === 'import',
  }
}

/**
 * After undo/redo put the caret on what the user will look for: a task that
 * came back, else the task that was focused, else the nearest survivor.
 */
function restoreFocus(state: AppState, snapshot: Task[]): Focus | null {
  const nowIds = new Set(state.tasks.map((t) => t.id))
  const thenIds = new Set(snapshot.map((t) => t.id))
  const current = state.focus?.id ?? null

  const revived = snapshot.find((t) => !nowIds.has(t.id))?.id
  if (revived) return focusOn(revived)
  if (current && thenIds.has(current)) return focusOn(current)
  // The focused task disappears: fall back to the closest row above it that survives.
  const rows = tree.flatten(state.tasks)
  const at = rows.findIndex((r) => r.task.id === current)
  for (let i = at - 1; i >= 0; i--) if (thenIds.has(rows[i].task.id)) return focusOn(rows[i].task.id)
  return null
}

function init(): AppState {
  const tasks = load()
  return {
    tasks,
    focus: tasks.length === 1 && !tasks[0].text ? focusOn(tasks[0].id) : null,
    past: [],
    future: [],
    typing: null,
    external: false,
  }
}

export function useTasks() {
  const [state, dispatch] = useReducer(withHistory, undefined, init)

  // Autosave, lightly debounced so typing doesn't serialise on every key.
  useEffect(() => {
    const flush = () => save(state.tasks)
    const timer = setTimeout(flush, 150)
    window.addEventListener('beforeunload', flush)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('beforeunload', flush)
    }
  }, [state.tasks])

  // Keep several open tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      const tasks = parse(e.newValue)
      if (tasks.length) dispatch({ type: 'replace', tasks })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return [state, dispatch] as const
}
