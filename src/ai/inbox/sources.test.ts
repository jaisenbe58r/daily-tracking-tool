import { describe, expect, it } from 'vitest'
import { candidatesFromEvents, candidatesFromThreads, cleanBody, describeCandidates, shortlist, type GmailThread } from './sources'
import { finish } from './extract'

const me = new Set(['yo@captia.com'])
const now = Date.parse('2026-09-30T12:00:00Z')
const thread = (id: string, messages: GmailThread['messages']): GmailThread => ({ id, messages, viewUrl: `https://mail.google.com/mail/#all/${id}` })

describe('candidatesFromThreads', () => {
  it('keeps a person writing to me directly, not in copy', () => {
    const direct = thread('a', [{ id: 'a1', sender: 'Ana <ana@cliente.es>', toRecipients: ['yo@captia.com'], date: '2026-09-30T09:00:00Z', subject: 'Presupuesto', plaintextBody: '¿Nos envías el presupuesto el viernes?' }])
    const cc = thread('b', [{ id: 'b1', sender: 'ana@cliente.es', toRecipients: ['otro@captia.com'], ccRecipients: ['yo@captia.com'], date: '2026-09-30T09:00:00Z' }])
    const bot = thread('c', [{ id: 'c1', sender: 'no-reply@servicio.com', toRecipients: ['yo@captia.com'], date: '2026-09-30T09:00:00Z' }])
    const replied = thread('d', [
      { id: 'd1', sender: 'ana@cliente.es', toRecipients: ['yo@captia.com'], date: '2026-09-29T09:00:00Z' },
      { id: 'd2', sender: 'yo@captia.com', toRecipients: ['ana@cliente.es'], date: '2026-09-29T10:00:00Z' },
    ])
    const out = candidatesFromThreads([direct, cc, bot, replied], me, 'ask', now)
    expect(out.map((c) => c.id)).toEqual(['a'])
    expect(out[0]).toMatchObject({ version: 'a1', source: 'Gmail', title: 'Presupuesto', body: '¿Nos envías el presupuesto el viernes?' })
  })

  it('leaves invitations to the calendar', () => {
    const invite = thread('i', [{ id: 'i1', sender: 'jefe@captia.com', toRecipients: ['yo@captia.com'], subject: 'Invitación: Kick-off', attachments: [{ mimeType: 'text/calendar', filename: 'invite.ics' }] }])
    expect(candidatesFromThreads([invite], me, 'ask', now)).toEqual([])
  })

  it('waiting: I wrote last, to someone else, two to ten days ago', () => {
    const t = (id: string, date: string) => thread(id, [{ id: `${id}1`, sender: 'yo@captia.com', toRecipients: ['marta@proveedor.es'], date, subject: 'Planos' }])
    const out = candidatesFromThreads([t('old', '2026-09-10T09:00:00Z'), t('ok', '2026-09-26T09:00:00Z'), t('new', '2026-09-30T09:00:00Z')], me, 'waiting', now)
    expect(out.map((c) => c.id)).toEqual(['ok'])
    expect(out[0].from).toContain('para marta@proveedor.es')
  })

  it('shortlist keeps long threads, whose preview may hide the latest message', () => {
    const long = thread('l', Array.from({ length: 5 }, (_, i) => ({ id: `l${i}`, sender: 'yo@captia.com', toRecipients: ['x@y.es'] })))
    expect(shortlist([long], me, 'ask', now)).toHaveLength(1)
  })
})

describe('cleanBody', () => {
  it('drops quoted history and signatures', () => {
    const body = 'Hola, ¿lo revisas?\n\n--\nAna\n\nEl lun, 29 sept escribió:\n> antes'
    expect(cleanBody(body)).toBe('Hola, ¿lo revisas?')
    expect(cleanBody('Vale.\n\nOn Mon, Sep 29 Ana wrote:\n> antes')).toBe('Vale.')
  })
})

describe('candidatesFromEvents', () => {
  it('keeps meetings waiting for my answer that I do not organize', () => {
    const events = [
      { id: 'e1', summary: 'Kick-off', updated: 'u1', htmlLink: 'https://www.google.com/calendar/event?eid=1', start: { dateTime: '2026-10-01T09:00:00+02:00' }, organizer: { email: 'jefe@captia.com' }, attendees: [{ email: 'yo@captia.com', self: true, responseStatus: 'needsAction' }] },
      { id: 'e2', summary: 'Aceptada', attendees: [{ email: 'yo@captia.com', self: true, responseStatus: 'accepted' }] },
      { id: 'e3', summary: 'Mía', organizer: { email: 'yo@captia.com', self: true }, attendees: [{ email: 'yo@captia.com', self: true, responseStatus: 'needsAction' }] },
    ]
    const out = candidatesFromEvents(events, me)
    expect(out.map((c) => c.id)).toEqual(['e1'])
    expect(describeCandidates(out)).toContain('[c1] Calendar · invitación sin responder')
  })
})

describe('finish', () => {
  it('turns the cited source into the task link and dates invitations', () => {
    const cands = candidatesFromEvents(
      [{ id: 'e1', summary: 'Kick-off', htmlLink: 'https://www.google.com/calendar/event?eid=1', start: { dateTime: '2026-10-01T09:00:00+02:00' }, organizer: { email: 'jefe@captia.com' }, attendees: [{ self: true, responseStatus: 'needsAction' }] }],
      me,
    )
    const ops = finish(
      [
        { op: 'add', text: 'Responder invitación: Kick-off', notes: 'c1' },
        { op: 'remove', id: 't1' },
        { op: 'add', text: 'Sin origen', notes: 'lo que sea' },
      ],
      cands,
    )
    expect(ops).toEqual([
      { op: 'add', text: 'Responder invitación: Kick-off', parent: null, tags: [], due: '2026-10-01', source: { app: 'calendar', url: 'https://www.google.com/calendar/event?eid=1', id: 'e1' } },
      { op: 'add', text: 'Sin origen', parent: null, tags: [], due: null },
    ])
  })
})
