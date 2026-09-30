import { describe, expect, it } from 'vitest'
import { newTask } from '../lib/tree'
import type { Task } from '../lib/types'
import {
  addDays, buildMemory, chronology, day, flight, mentions, mondayOf, pageFor, perWeek, related, trama, zeroDays,
} from './graph'
import { diffEvents, newEvents, sanitizeLog, type LogEvent } from './log'

// Wednesday 30 September 2026.
const now = new Date(2026, 8, 30, 18)
const at = (day: string, hour = 10) => new Date(`${day}T${String(hour).padStart(2, '0')}:00`).getTime()
const t = (id: string, text: string, extra: Partial<Task> = {}): Task => ({ ...newTask(null, text), id, createdAt: at('2026-09-28'), ...extra })
const done = (day: string): Partial<Task> => ({ status: 'done', completedAt: at(day, 16) })

describe('mentions', () => {
  it('reads @people in text and notes, not dates', () => {
    expect(mentions({ text: 'Consultar a @Luis el acceso @viernes', notes: 'con @ana_ferrer' }, now)).toEqual(['luis', 'ana_ferrer'])
    expect(mentions({ text: 'correo a jaime@captia.com', notes: '' }, now)).toEqual([])
    expect(mentions({ text: 'Revisar @3/10', notes: '' }, now)).toEqual([])
  })
})

describe('diffEvents', () => {
  it('logs birth when a line gets words, status changes, snoozes, moves and deletions', () => {
    const blank = t('a', '')
    const other = t('b', 'Informe', { status: 'todo' })
    const before = [blank, other]
    const after: Task[] = [
      { ...blank, text: 'Validar torno 04' },
      { ...other, status: 'doing', parentId: 'a', snooze: { until: '2026-10-02', since: '2026-09-30' } },
    ]
    expect(diffEvents(before, after, 1).map((e) => `${e.id}:${e.kind}`)).toEqual(['a:create', 'b:doing', 'b:snooze', 'b:move'])
    const closed = [{ ...after[0], status: 'done' as const }, after[1]]
    expect(diffEvents(after, closed, 2).map((e) => e.kind)).toEqual(['done'])
    expect(diffEvents(closed, after, 3).map((e) => e.kind)).toEqual(['reopen'])
    expect(diffEvents(after, [after[0]], 4)).toEqual([{ at: 4, id: 'b', kind: 'remove', text: 'Informe' }])
  })

  it('ignores empty rows and typing on a task that already exists', () => {
    const a = t('a', 'Validar')
    expect(diffEvents([], [t('x', '')], 1)).toEqual([])
    expect(diffEvents([a], [{ ...a, text: 'Validar torno' }], 1)).toEqual([])
  })

  it('merges a backup without duplicates and drops junk', () => {
    const log: LogEvent[] = [{ at: 1, id: 'a', kind: 'create', text: 'x' }]
    expect(newEvents(log, [...log, { at: 2, id: 'a', kind: 'done' }])).toEqual([{ at: 2, id: 'a', kind: 'done' }])
    expect(sanitizeLog([{ at: 1, id: 'a', kind: 'nope' }, null, { at: 'x' }, { at: 3, id: 'b', kind: 'done' }])).toEqual([{ at: 3, id: 'b', kind: 'done' }])
  })
})

describe('buildMemory', () => {
  const zim = t('zim', 'Proyecto ZimVie', { createdAt: at('2026-09-01') })
  const tasks: Task[] = [
    zim,
    t('z1', 'Validar torno 04 con @luis', { parentId: 'zim', tags: ['torno04'], createdAt: at('2026-09-01'), ...done('2026-09-15') }),
    t('z2', 'Consultar OPC-UA a @Luis', { parentId: 'zim', createdAt: at('2026-09-20') }),
    t('z3', 'Informe OEE', { parentId: 'zim', tags: ['torno04'], createdAt: at('2026-09-29'), ...done('2026-09-29'), due: '2026-09-29' }),
    t('solo', 'Revisar Captia @marta', { tags: ['demo'], createdAt: at('2026-09-30'), ...done('2026-09-30') }),
    t('one', 'Una hija no basta'),
    t('kid', 'hija', { parentId: 'one' }),
    t('blank', ''),
  ]
  const mem = buildMemory(tasks, [], now)

  it('finds projects, people and topics from what was captured', () => {
    expect(mem.projects.map((p) => p.id)).toEqual(['zim'])
    expect(mem.people).toEqual(['luis', 'marta'])
    expect(mem.tags).toEqual(['torno04', 'demo'])
    expect(mem.index.get('p:zim')?.map((x) => x.id)).toEqual(['z1', 'z2', 'z3'])
    expect(mem.work.some((x) => x.id === 'zim')).toBe(false)
    expect(mem.keys.get('z1')).toEqual(['p:zim', 'h:luis', 't:torno04'])
    expect(mem.tasks.some((x) => x.id === 'blank')).toBe(false)
  })

  it('relates pages by shared tasks and counts them per week', () => {
    expect(related(mem, 'h:luis')).toEqual([['p:zim', 2], ['t:torno04', 1]])
    const rows = trama(mem, 'p:zim')
    expect(rows.map((r) => r.key)).toEqual(['p:zim', 'h:luis', 't:torno04'])
    const w = mem.weeks.indexOf(mondayOf('2026-09-29'))
    expect(rows[0].counts[w]).toBe(1)
    expect(perWeek(mem, mem.tasks).reduce((a, b) => a + b, 0)).toBe(mem.tasks.length)
  })

  it('covers at least twelve weeks, ending this week', () => {
    expect(mem.weeks.length).toBe(12)
    expect(mem.weeks.at(-1)).toBe('2026-09-28')
    expect(addDays(mem.weeks[0], 7)).toBe(mem.weeks[1])
  })

  it('backfills history from the sheet and reads days from it', () => {
    expect(mem.events.filter((e) => e.id === 'z1').map((e) => e.kind)).toEqual(['create', 'done'])
    const d = day(mem, '2026-09-29')
    expect(d.closed.map((x) => x.id)).toEqual(['z3'])
    expect(flight(tasks[1])).toBe(14)
  })

  it('marks days whose planned tasks were all closed', () => {
    expect([...zeroDays(mem)]).toEqual(['2026-09-29'])
    const late = buildMemory([...tasks, t('late', 'Pendiente', { due: '2026-09-29', createdAt: at('2026-09-28') })], [], now)
    expect(zeroDays(late).has('2026-09-29')).toBe(false)
  })

  it('writes a month-by-month chronology and picks a landing page', () => {
    expect(chronology(mem, 'p:zim').map((m) => [m.month, m.closed])).toEqual([['2026-09', 2]])
    expect(pageFor(mem, 'z2')).toBe('p:zim')
    expect(pageFor(mem, 'zim')).toBe('p:zim')
    expect(pageFor(mem, 'one')).toBe('panorama')
    expect(pageFor(mem, null)).toBe('panorama')
  })
})
