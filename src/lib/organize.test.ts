import { describe, expect, it } from 'vitest'
import type { Task } from './types'
import { newTask, update } from './tree'
import { organize } from './organize'

const t = (id: string, parentId: string | null, extra: Partial<Task> = {}): Task => ({ ...newTask(parentId, id), id, ...extra })
const ids = (rows: { task: Task }[]) => rows.map((r) => r.task.id)
const none = { tag: null, hideDone: false, today: false, query: '' }

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
    const [g] = organize(collapsed, 'manual', { tag: 'it', hideDone: false, today: false, query: '' })
    expect(ids(g.rows)).toEqual(['zimvie', 'torno', 'it'])
    expect(g.rows.map((r) => !!r.dimmed)).toEqual([true, true, false])
    expect(g.inherit).toEqual({ tags: ['it'] })
  })

  it('searches text, notes and tags ignoring accents', () => {
    const list = [t('a', null, { text: 'Formación Copilot' }), t('b', null, { text: 'Otra', notes: 'ver formacion' }), t('c', null, { text: 'Nada' })]
    const [g] = organize(list, 'manual', { ...none, query: 'FORMACION' })
    expect(ids(g.rows)).toEqual(['a', 'b'])
  })

  it('matches every search word in any order', () => {
    const list = [t('a', null, { text: 'Informe para Ana', tags: ['zimvie'] }), t('b', null, { text: 'Informe mensual' })]
    expect(ids(organize(list, 'manual', { ...none, query: 'ana informe' })[0].rows)).toEqual(['a'])
    expect(ids(organize(list, 'manual', { ...none, query: 'informe #zimvie' })[0].rows)).toEqual(['a'])
  })

  it('hides done tasks', () => {
    const [g] = organize(tasks, 'manual', { tag: null, hideDone: true, today: false, query: '' })
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

  it('today shows what is due or overdue, and what got done today', () => {
    const now = new Date(2026, 8, 28, 12).getTime()
    const list = [
      t('due', null, { due: '2026-09-28' }),
      t('late', null, { due: '2026-09-20' }),
      t('later', null, { due: '2026-10-01' }),
      t('doneNow', null, { status: 'done', completedAt: now }),
      t('doneBefore', null, { status: 'done', completedAt: now - 3 * 86_400_000, due: '2026-09-25' }),
    ]
    const [g] = organize(list, 'manual', { tag: null, hideDone: false, today: true, query: '' }, now)
    expect(ids(g.rows)).toEqual(['due', 'late', 'doneNow'])
    expect(g.inherit).toEqual({ due: '2026-09-28' })
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
