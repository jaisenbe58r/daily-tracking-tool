import { describe, expect, it } from 'vitest'
import { busyFrom, emailsIn, freeSlot, invitees, isoLocal, mentions, parseAdjust, readPlan, workingDays } from './schedule'

// Thursday 1 October 2026, 11:00 local time.
const now = new Date(2026, 9, 1, 11, 0)
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime()

describe('workingDays', () => {
  it('skips the weekend and starts tomorrow', () => {
    expect(workingDays(now, 2)).toEqual(['2026-10-02', '2026-10-05'])
  })
})

describe('freeSlot', () => {
  it('takes the first free half hour from 9:00, around what is busy', () => {
    const busy = [
      { start: at(2, 9), end: at(2, 10) },
      { start: at(2, 10, 15), end: at(2, 11) },
    ]
    expect(freeSlot(busy, ['2026-10-02'], 30, now.getTime())).toEqual(new Date(at(2, 11)))
    expect(freeSlot([], ['2026-10-02'], 30, now.getTime())).toEqual(new Date(at(2, 9)))
  })

  it('goes to the next day when one is full, and gives up after the last', () => {
    const full = [{ start: at(2, 8), end: at(2, 18) }]
    expect(freeSlot(full, ['2026-10-02', '2026-10-05'], 30, now.getTime())).toEqual(new Date(at(5, 9)))
    expect(freeSlot(full, ['2026-10-02'], 30, now.getTime())).toBeNull()
  })

  it('a long meeting must end by 18:00; a fixed time is the only one tried', () => {
    const busy = [{ start: at(2, 9), end: at(2, 17) }]
    expect(freeSlot(busy, ['2026-10-02'], 90, now.getTime())).toBeNull()
    expect(freeSlot(busy, ['2026-10-02'], 60, now.getTime())).toEqual(new Date(at(2, 17)))
    expect(freeSlot([], ['2026-10-02'], 30, now.getTime(), 10 * 60)).toEqual(new Date(at(2, 10)))
    expect(freeSlot([{ start: at(2, 10), end: at(2, 11) }], ['2026-10-02'], 30, now.getTime(), 10 * 60)).toBeNull()
  })

  it('never proposes a time already past', () => {
    expect(freeSlot([], ['2026-10-01'], 30, now.getTime())).toEqual(new Date(at(1, 11)))
  })
})

describe('busyFrom', () => {
  it('ignores cancelled, declined, all-day and free events', () => {
    const ev = (extra: object) => ({ id: 'x', start: { dateTime: '2026-10-02T09:00:00Z' }, end: { dateTime: '2026-10-02T10:00:00Z' }, ...extra })
    const me = new Set(['yo@captia.com'])
    const events = [
      ev({}),
      ev({ status: 'cancelled' }),
      ev({ transparency: 'transparent' }),
      ev({ attendees: [{ email: 'yo@captia.com', responseStatus: 'declined' }] }),
      { id: 'all', start: { date: '2026-10-02' }, end: { date: '2026-10-03' } },
    ]
    expect(busyFrom(events, me)).toEqual([{ start: Date.parse('2026-10-02T09:00:00Z'), end: Date.parse('2026-10-02T10:00:00Z') }])
  })
})

describe('isoLocal', () => {
  it('writes the local time with its offset', () => {
    const iso = isoLocal(new Date(at(2, 10, 30)))
    expect(iso).toMatch(/^2026-10-02T10:30:00[+-]\d{2}:\d{2}$/)
    expect(Date.parse(iso)).toBe(at(2, 10, 30))
  })
})

describe('parseAdjust', () => {
  it('reads a day with the sheet grammar, a time and a length', () => {
    expect(parseAdjust('el jueves a las 10', now)).toEqual({ day: '2026-10-08', time: 600, minutes: null })
    expect(parseAdjust('mañana 16:30, 1 hora', now)).toEqual({ day: '2026-10-02', time: 990, minutes: 60 })
    expect(parseAdjust('hora y media', now)).toMatchObject({ minutes: 90, time: null, day: null })
    expect(parseAdjust('45 min', now)).toMatchObject({ minutes: 45 })
    expect(parseAdjust('1h', now)).toMatchObject({ minutes: 60, time: null })
    expect(parseAdjust('16h', now)).toMatchObject({ minutes: null, time: 960 })
    expect(parseAdjust('a las 4', now)).toMatchObject({ time: 960 })
    expect(parseAdjust('el 5/10', now)).toMatchObject({ day: '2026-10-05' })
    expect(parseAdjust('', now)).toEqual({ day: null, time: null, minutes: null })
  })
})

describe('invitees', () => {
  it('invites known addresses, matches @names to them, keeps the rest as names', () => {
    const text = 'Revisar oferta con @ana y @marta, copia a luis@proveedor.es'
    expect(mentions(text)).toEqual(['ana', 'marta'])
    expect(mentions('Llamar @lunes a @luis')).toEqual(['luis'])
    const known = [...emailsIn(text), 'Ana García <ana.garcia@cliente.es>', 'yo@captia.com']
    expect(invitees(mentions(text), known, new Set(['yo@captia.com']))).toEqual({ emails: ['luis@proveedor.es', 'ana.garcia@cliente.es'], names: ['marta'] })
  })
})

describe('readPlan', () => {
  it('title on the first line, agenda below', () => {
    expect(readPlan('Título: «Oferta Ubesol»\n- Precio\nPlazos', 'x')).toEqual({ title: 'Oferta Ubesol', agenda: ['- Precio', '- Plazos'] })
    expect(readPlan('- Precio', 'Revisar oferta')).toEqual({ title: 'Revisar oferta', agenda: ['- Precio'] })
    expect(readPlan('', 'Revisar oferta')).toEqual({ title: 'Revisar oferta', agenda: [] })
  })
})
