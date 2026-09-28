import { describe, expect, it } from 'vitest'
import { carryOver, dailySummary, isStale, subtreeOutline } from './daily'
import { parseOutline } from './parse'
import { flatten, newTask } from './tree'
import type { Task } from './types'

const today = '2026-09-28'
const now = new Date(2026, 8, 28, 10).getTime()
const yesterday = now - 86_400_000
const t = (id: string, parentId: string | null, extra: Partial<Task> = {}): Task => ({ ...newTask(parentId, id), id, createdAt: now, ...extra })
const ids = (tasks: Task[]) => flatten(tasks).map((r) => `${'  '.repeat(r.depth)}${r.task.id}`)

describe('carryOver', () => {
  it('raises yesterday’s open top-level tasks, subtasks included', () => {
    const tasks = [
      t('new', null),
      t('oldDone', null, { createdAt: yesterday, status: 'done', completedAt: yesterday }),
      t('oldOpen', null, { createdAt: yesterday }),
      t('child', 'oldOpen', { createdAt: yesterday }),
    ]
    expect(ids(carryOver(tasks, today))).toEqual(['oldOpen', '  child', 'new', 'oldDone'])
  })

  it('returns the same list when nothing needs to move', () => {
    const tasks = [t('a', null, { createdAt: yesterday }), t('b', null)]
    expect(carryOver(tasks, today)).toBe(tasks)
    expect(isStale(tasks[0], today)).toBe(true)
    expect(isStale(tasks[1], today)).toBe(false)
  })
})

describe('dailySummary', () => {
  it('lists what got done today and what is in progress', () => {
    const tasks = [
      t('Proyecto', null),
      t('Revisar alarmas', 'Proyecto', { status: 'done', completedAt: now, tags: ['zimvie'] }),
      t('Validar torno', 'Proyecto', { status: 'doing' }),
      t('Viejo', null, { status: 'done', completedAt: yesterday }),
    ]
    expect(dailySummary(tasks, today)).toBe(
      ['**Lunes, 28 de septiembre**', '', '**Hecho**', '- Revisar alarmas _(Proyecto)_ #zimvie', '', '**En curso**', '- Validar torno _(Proyecto)_'].join('\n'),
    )
  })
})

describe('subtreeOutline', () => {
  it('round-trips through the paste parser', () => {
    const tasks = [t('Visita', null, { priority: true }), t('Preparar', 'Visita', { tags: ['cliente'] }), t('Acta', 'Preparar')]
    const outline = subtreeOutline(tasks, 'Visita')
    expect(outline).toBe('Visita !\n\tPreparar #cliente\n\t\tActa')
    expect(parseOutline(outline).map((i) => i.depth)).toEqual([0, 1, 2])
  })
})
