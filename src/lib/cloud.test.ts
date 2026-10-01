import { describe, expect, it } from 'vitest'
import { hash, join, merge, plan, readSheet, serialize, split, weekOf, weeksToWrite, type Sheet } from './cloud'
import type { LogEvent } from '../memory/log'
import { sanitize } from './persist'

const sheet = (...texts: string[]): Sheet => ({
  tasks: sanitize(texts.map((text, i) => ({ id: `t${i}-${text}`, text, createdAt: 1 }))),
  templates: [],
})
const at = (s: Sheet, savedAt: number) => ({ savedAt, sheet: s })
const baseOf = (s: Sheet, savedAt: number) => ({ savedAt, hash: hash(serialize(s)) })

describe('cloud', () => {
  it('splits a sheet into parts and joins them back', () => {
    const text = serialize(sheet(...Array.from({ length: 50 }, (_, i) => `Tarea número ${i} con acentos ñáé`)))
    const parts = split(text, 7, 500)
    expect(parts.length).toBeGreaterThan(1)
    const docs = new Map(parts.map((p, i) => [`folio-${i}`, p]))
    expect(join(docs)).toEqual({ savedAt: 7, text })
    expect(readSheet(text)).not.toBeNull()
    expect(serialize(readSheet(text)!)).toBe(text)
  })

  it('waits while a save is still landing', () => {
    const parts = split('x'.repeat(30), 2, 10)
    const docs = new Map<string, unknown>([['folio-0', parts[0]], ['folio-1', { ...parts[1], savedAt: 1 }], ['folio-2', parts[2]]])
    expect(join(docs)).toBeNull()
    expect(join(new Map())).toBeNull()
  })

  it('uploads this browser’s sheet to an empty store, but not a blank one', () => {
    expect(plan(null, sheet('Preparar demo'), null).kind).toBe('push')
    expect(plan(null, sheet(''), null).kind).toBe('keep')
  })

  it('takes the store’s sheet on a fresh device', () => {
    const remote = sheet('Preparar demo')
    expect(plan(at(remote, 5), sheet(''), null)).toEqual({ kind: 'take', sheet: remote })
  })

  it('takes changes from another device when this one has none', () => {
    const old = sheet('A')
    const remote = sheet('A', 'B')
    expect(plan(at(remote, 9), old, baseOf(old, 5))).toEqual({ kind: 'take', sheet: remote })
  })

  it('pushes when only this device changed', () => {
    const old = sheet('A')
    expect(plan(at(old, 5), sheet('A', 'B'), baseOf(old, 5)).kind).toBe('push')
  })

  it('merges when both changed, keeping tasks from each side', () => {
    const old = sheet('A')
    const remote = sheet('A', 'B')
    const local: Sheet = { tasks: [...old.tasks, ...sanitize([{ id: 'c', text: 'C' }])], templates: [{ name: 'x', outline: 'y' }] }
    const next = plan(at(remote, 9), local, baseOf(old, 5))
    expect(next.kind).toBe('merge')
    if (next.kind !== 'merge') return
    expect(next.sheet.tasks.map((t) => t.text)).toEqual(['A', 'B', 'C'])
    expect(next.sheet.templates).toEqual([{ name: 'x', outline: 'y' }])
  })

  it('does nothing when both sides already agree', () => {
    const s = sheet('A')
    expect(plan(at(s, 9), s, null).kind).toBe('keep')
  })

  it('merge never brings back empty rows', () => {
    expect(merge(sheet('A'), sheet('')).tasks.map((t) => t.text)).toEqual(['A'])
  })
})

describe('cloud history', () => {
  const ev = (at: number, id = 'a', kind: LogEvent['kind'] = 'create'): LogEvent => ({ at, id, kind })
  const monday = new Date(2026, 8, 28, 10).getTime()
  const sunday = new Date(2026, 9, 4, 22).getTime()
  const nextMonday = new Date(2026, 9, 5, 8).getTime()

  it('groups by the week starting on Monday', () => {
    expect(weekOf(monday)).toBe('2026-09-28')
    expect(weekOf(sunday)).toBe('2026-09-28')
    expect(weekOf(nextMonday)).toBe('2026-10-05')
  })

  it('writes only the weeks where this device has something new, keeping what the store has', () => {
    const remote = new Map([['2026-09-28', [ev(monday), ev(sunday, 'b')]]])
    const out = weeksToWrite([ev(monday), ev(sunday + 1, 'c', 'done'), ev(nextMonday)], remote)
    expect([...out.keys()]).toEqual(['2026-09-28', '2026-10-05'])
    expect(out.get('2026-09-28')!.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(weeksToWrite([ev(monday)], remote).size).toBe(0)
  })

  it('never writes the same event twice', () => {
    const out = weeksToWrite([ev(monday), ev(monday)], new Map())
    expect(out.get('2026-09-28')).toHaveLength(1)
  })
})
