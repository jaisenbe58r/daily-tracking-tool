import type { Status, Task } from '../lib/types'
import * as tree from '../lib/tree'
import { dateKey } from '../lib/parse'
import { plantNext } from '../lib/repeat'

/** What the agent can propose. Validated by `proposalSchema` (schema.ts) before it gets here. */
export interface Op {
  op: 'add' | 'update' | 'move' | 'remove'
  /** Existing task (`t3`) for update/move/remove. */
  id?: string
  /** Name for a task being added (`n1`), so later adds can nest under it. */
  ref?: string
  /** Parent for add/move: an existing `t…`, a new `n…`, or null for top level. */
  parent?: string | null
  text?: string
  notes?: string
  tags?: string[]
  /** YYYY-MM-DD, or null to unplan. */
  due?: string | null
  priority?: boolean
  status?: Status
}

export interface Proposal {
  /** One short line for the user, in their language. */
  summary: string
  ops: Op[]
}

/** How the agent sees the sheet: short refs instead of UUIDs. */
export interface Snapshot {
  text: string
  refs: Map<string, string>
}

const weekday = new Intl.DateTimeFormat('es-ES', { weekday: 'long' })

/**
 * One line per task in tree order: `t2 < t1 | doing | 2026-09-30 | #zimvie ! | Validar torno 04`.
 * Empty rows are left out; they mean nothing to the agent.
 */
export function snapshot(tasks: Task[], today: string, selectedId: string | null = null): Snapshot {
  const refs = new Map<string, string>()
  const refOf = new Map<string, string>()
  const lines: string[] = []
  const walk = (parentId: string | null) => {
    for (const t of tree.childrenOf(tasks, parentId)) {
      if (t.text.trim()) {
        const ref = `t${refs.size + 1}`
        refs.set(ref, t.id)
        refOf.set(t.id, ref)
        const parent = t.parentId ? refOf.get(t.parentId) : undefined
        const marks = [...t.tags.map((g) => `#${g}`), t.priority ? '!' : '', t.repeat ? `↻${t.repeat}` : ''].filter(Boolean).join(' ')
        lines.push([parent ? `${ref} < ${parent}` : ref, t.status, t.due ?? '-', marks || '-', t.text.trim()].join(' | '))
      }
      walk(t.id)
    }
  }
  walk(null)
  const [y, m, d] = today.split('-').map(Number)
  const head = [`Hoy: ${today} (${weekday.format(new Date(y, m - 1, d))})`]
  const selected = selectedId ? refOf.get(selectedId) : undefined
  if (selected) head.push(`Tarea seleccionada: ${selected}`)
  head.push(`Tareas (ref < padre | estado | fecha | marcas | texto):`, lines.length ? lines.join('\n') : '(ninguna)')
  return { text: head.join('\n'), refs }
}

export type Change =
  | { kind: 'add'; text: string; depth: number; detail: string }
  | { kind: 'update'; text: string; detail: string }
  | { kind: 'done'; text: string }
  | { kind: 'move'; text: string; detail: string }
  | { kind: 'remove'; text: string }

const cleanTags = (tags: string[]) => [...new Set(tags.map((t) => t.replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))]
const validDue = (due: string | null | undefined) => (due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null)

function withStatus(task: Task, status: Status): Partial<Task> {
  return { status, completedAt: status === 'done' ? (task.completedAt ?? Date.now()) : null }
}

function describe(patch: Partial<Task>): string {
  const parts: string[] = []
  if (patch.text !== undefined) parts.push(`«${patch.text}»`)
  if (patch.tags) parts.push(patch.tags.map((t) => `#${t}`).join(' ') || 'sin tags')
  if (patch.due !== undefined) parts.push(patch.due ?? 'sin fecha')
  if (patch.priority !== undefined) parts.push(patch.priority ? 'prioridad' : 'sin prioridad')
  if (patch.status === 'doing') parts.push('en curso')
  if (patch.status === 'todo') parts.push('pendiente')
  if (patch.notes !== undefined) parts.push('nota')
  return parts.join(' · ')
}

/**
 * Applies a proposal to a copy of the sheet. Ops that point at tasks that don't
 * exist are skipped rather than failing the whole proposal.
 */
export function applyOps(
  tasks: Task[],
  ops: Op[],
  refs: Map<string, string>,
  today = dateKey(new Date()),
): { tasks: Task[]; changes: Change[] } {
  let out = tasks
  const ids = new Map(refs)
  const depthOf = new Map<string, number>()
  const resolve = (ref: string | null | undefined) => (ref ? ids.get(ref.trim()) : undefined)
  const find = (id: string | undefined) => (id ? out.find((t) => t.id === id) : undefined)
  const changes: Change[] = []

  for (const op of ops) {
    if (op.op === 'add') {
      const text = op.text?.trim()
      if (!text) continue
      const parentId = resolve(op.parent) ?? null
      let task: Task = {
        ...tree.newTask(parentId, text),
        notes: op.notes?.trim() ?? '',
        tags: cleanTags(op.tags ?? []),
        due: validDue(op.due),
        priority: op.priority ?? false,
      }
      if (op.status) task = { ...task, ...withStatus(task, op.status) }
      out = tree.place(parentId ? tree.update(out, parentId, { collapsed: false }) : out, task, parentId, null)
      if (op.ref) ids.set(op.ref.trim(), task.id)
      const depth = parentId && depthOf.has(parentId) ? depthOf.get(parentId)! + 1 : 0
      depthOf.set(task.id, depth)
      const detail = [task.tags.map((t) => `#${t}`).join(' '), task.due ?? '', task.priority ? '!' : ''].filter(Boolean).join(' ')
      changes.push({ kind: 'add', text, depth, detail })
      continue
    }

    const task = find(resolve(op.id))
    if (!task) continue

    if (op.op === 'remove') {
      out = tree.remove(out, task.id)
      changes.push({ kind: 'remove', text: task.text })
    } else if (op.op === 'move') {
      const parentId = resolve(op.parent) ?? null
      const next = tree.moveTo(out, task.id, parentId, null)
      if (next === out) continue
      out = next
      const parent = find(parentId ?? undefined)
      changes.push({ kind: 'move', text: task.text, detail: parent ? `bajo «${parent.text}»` : 'al primer nivel' })
    } else {
      const patch: Partial<Task> = {}
      if (op.text?.trim() && op.text.trim() !== task.text) patch.text = op.text.trim()
      if (op.notes !== undefined && op.notes !== task.notes) patch.notes = op.notes
      if (op.tags) patch.tags = cleanTags(op.tags)
      if (op.due !== undefined) patch.due = validDue(op.due)
      if (op.priority !== undefined && op.priority !== task.priority) patch.priority = op.priority
      const status = op.status && op.status !== task.status ? op.status : undefined
      if (!Object.keys(patch).length && !status) continue
      out = tree.update(out, task.id, { ...patch, ...(status ? withStatus(task, status) : {}) })
      // Same as completing by hand: a recurring task plants its next occurrence.
      if (status === 'done') out = plantNext(out, task.id, today)
      if (status === 'done') changes.push({ kind: 'done', text: task.text })
      const detail = describe({ ...patch, ...(status && status !== 'done' ? { status } : {}) })
      if (detail) changes.push({ kind: 'update', text: task.text, detail })
    }
  }
  // A fresh sheet is one empty line waiting for input; once the AI fills it, that line is noise.
  const placeholder = tasks.length === 1 && !tasks[0].text.trim() ? tasks[0] : null
  if (placeholder && out.length > 1 && !tree.hasChildren(out, placeholder.id)) out = out.filter((t) => t.id !== placeholder.id)
  return { tasks: out, changes }
}

/** Task ids for the refs the agent picked (`t3`), in its order, skipping unknown ones. */
export function idsFor(refs: Map<string, string>, picked: string[]): string[] {
  return [...new Set(picked.map((r) => refs.get(r.trim())).filter((id): id is string => Boolean(id)))]
}
