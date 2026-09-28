import { describe, expect, it } from 'vitest'
import type { Task } from './types'
import { newTask, update } from './tree'
import { organize } from './organize'

const t = (id: string, parentId: string | null, extra: Partial<Task> = {}): Task => ({ ...newTask(parentId, id), id, ...extra })
const ids = (rows: { task: Task }[]) => rows.map((r) => r.task.id)
const none = { tag: null, hideDone: false }

const tasks = [
  t('zimvie', null, { tags: ['zimvie'], createdAt: 1_000 }),
  t('alarmas', 'zimvie', { status: 'done', createdAt: 2_000 }),
  t('torno', 'zimvie', { status: 'doing', createdAt: 3_000 }),
  t('it', 'torno', { tags: ['it'], createdAt: 4_000 }),
  t('copilot', null, { createdAt: 86_400_000 * 3 }),
]

describe('organize', () => {
  it('manual mode is the tree', () => {
    const [g] = organize(tasks, 'manual', none)
    expect(ids(g.rows)).toEqual(['zimvie', 'alarmas', 'torno', 'it', 'copilot'])
  })

  it('filters keep ancestors as dimmed context and open collapsed parents', () => {
    const collapsed = update(tasks, 'zimvie', { collapsed: true })
    const [g] = organize(collapsed, 'manual', { tag: 'it', hideDone: false })
    expect(ids(g.rows)).toEqual(['zimvie', 'torno', 'it'])
    expect(g.rows.map((r) => !!r.dimmed)).toEqual([true, true, false])
    expect(g.inherit).toEqual({ tags: ['it'] })
  })

  it('hides done tasks', () => {
    const [g] = organize(tasks, 'manual', { tag: null, hideDone: true })
    expect(ids(g.rows)).not.toContain('alarmas')
  })

  it('groups by status with parent paths', () => {
    const groups = organize(tasks, 'status', none)
    expect(groups.map((g) => [g.label, ids(g.rows)])).toEqual([
      ['En curso', ['torno']],
      ['Pendiente', ['zimvie', 'it', 'copilot']],
      ['Hecha', ['alarmas']],
    ])
    expect(groups[1].rows[1].context).toBe('zimvie › torno')
    expect(groups[0].inherit).toEqual({ status: 'doing' })
  })

  it('groups by tag, untagged last', () => {
    const groups = organize(tasks, 'tag', none)
    expect(groups.map((g) => g.label)).toEqual(['#it', '#zimvie', 'Sin tag'])
  })

  it('groups by creation day, newest first', () => {
    const groups = organize(tasks, 'date', none, 86_400_000 * 3 + 1000)
    expect(groups[0].label).toBe('Hoy')
    expect(ids(groups[0].rows)).toEqual(['copilot'])
    expect(ids(groups[1].rows)).toEqual(['it', 'torno', 'alarmas', 'zimvie'])
  })
})
