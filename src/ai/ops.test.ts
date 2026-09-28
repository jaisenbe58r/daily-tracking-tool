import { describe, expect, it } from 'vitest'
import { newTask } from '../lib/tree'
import type { Task } from '../lib/types'
import { applyOps, snapshot } from './ops'

function sheet(): Task[] {
  const zimvie = { ...newTask(null, 'Proyecto ZimVie'), tags: ['zimvie'] }
  const torno = { ...newTask(zimvie.id, 'Validar torno 04'), status: 'doing' as const }
  const copilot = { ...newTask(null, 'Formación GitHub Copilot'), due: '2026-09-29', priority: true }
  return [zimvie, torno, newTask(null, ''), copilot]
}

describe('snapshot', () => {
  it('lists tasks in tree order with short refs and skips empty rows', () => {
    const tasks = sheet()
    const snap = snapshot(tasks, '2026-09-28', tasks[1].id)
    expect(snap.text).toContain('Hoy: 2026-09-28 (lunes)')
    expect(snap.text).toContain('Tarea seleccionada: t2')
    expect(snap.text).toContain('t1 | todo | - | #zimvie | Proyecto ZimVie')
    expect(snap.text).toContain('t2 < t1 | doing | - | - | Validar torno 04')
    expect(snap.text).toContain('t3 | todo | 2026-09-29 | ! | Formación GitHub Copilot')
    expect(snap.refs.get('t3')).toBe(tasks[3].id)
  })
})

describe('applyOps', () => {
  it('adds a tree, nesting later adds under earlier refs', () => {
    const tasks = sheet()
    const { refs } = snapshot(tasks, '2026-09-28')
    const { tasks: out, changes } = applyOps(
      tasks,
      [
        { op: 'add', ref: 'n1', text: 'Preparar demo Captia', tags: ['#Captia'], due: '2026-10-01' },
        { op: 'add', ref: 'n2', parent: 'n1', text: 'Revisar guion' },
        { op: 'add', parent: 't1', text: 'Preparar informe' },
      ],
      refs,
    )
    const demo = out.find((t) => t.text === 'Preparar demo Captia')!
    expect(demo).toMatchObject({ parentId: null, tags: ['captia'], due: '2026-10-01' })
    expect(out.find((t) => t.text === 'Revisar guion')!.parentId).toBe(demo.id)
    expect(out.find((t) => t.text === 'Preparar informe')!.parentId).toBe(tasks[0].id)
    expect(changes.map((c) => c.kind === 'add' && c.depth)).toEqual([0, 1, 0])
  })

  it('updates, completes, moves and removes existing tasks', () => {
    const tasks = sheet()
    const { refs } = snapshot(tasks, '2026-09-28')
    const { tasks: out, changes } = applyOps(
      tasks,
      [
        { op: 'update', id: 't1', tags: ['zimvie', 'urgente'], due: '2026-09-29' },
        { op: 'update', id: 't2', status: 'done' },
        { op: 'move', id: 't3', parent: 't1' },
        { op: 'remove', id: 't9' },
      ],
      refs,
    )
    expect(out.find((t) => t.id === tasks[0].id)).toMatchObject({ tags: ['zimvie', 'urgente'], due: '2026-09-29' })
    expect(out.find((t) => t.id === tasks[1].id)!.completedAt).not.toBeNull()
    expect(out.find((t) => t.id === tasks[3].id)!.parentId).toBe(tasks[0].id)
    expect(changes.map((c) => c.kind)).toEqual(['update', 'done', 'move'])

    const removed = applyOps(tasks, [{ op: 'remove', id: 't1' }], refs)
    expect(removed.tasks.find((t) => t.id === tasks[1].id)!.parentId).toBeNull()
  })

  it('ignores invalid dates and no-op updates', () => {
    const tasks = sheet()
    const { refs } = snapshot(tasks, '2026-09-28')
    const { changes, tasks: out } = applyOps(
      tasks,
      [
        { op: 'add', text: 'Llamar a IT', due: 'mañana' },
        { op: 'update', id: 't2', status: 'doing' },
      ],
      refs,
    )
    expect(out.find((t) => t.text === 'Llamar a IT')!.due).toBeNull()
    expect(changes).toHaveLength(1)
  })

  it('drops the empty line of a fresh sheet once tasks are added', () => {
    const blank = [newTask()]
    const { tasks: out } = applyOps(blank, [{ op: 'add', text: 'Revisar Captia.ai' }], new Map())
    expect(out.map((t) => t.text)).toEqual(['Revisar Captia.ai'])
  })
})
