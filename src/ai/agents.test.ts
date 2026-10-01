import { describe, expect, it } from 'vitest'
import { newTask } from '../lib/tree'
import type { Task } from '../lib/types'
import { finish } from './inbox/extract'
import { replyCandidate, sourceId, watchedTasks, type Candidate } from './inbox/sources'
import { describeThread } from './drafts'
import { meetingTask, meetingWhen, meetingsFrom } from './meeting'

const t = (extra: Partial<Task>): Task => ({ ...newTask(null, 'x'), createdAt: Date.parse('2026-09-28T10:00:00Z'), ...extra })
const gmail = (url: string, extra = {}) => ({ app: 'gmail' as const, url, ...extra })

describe('sourceId', () => {
  it('prefers the stored id', () => {
    expect(sourceId(gmail('https://mail.google.com/x#all/thread-f:1', { id: '19a' }))).toBe('19a')
  })
  it('reads Gmail thread-f (decimal) as the API id (hex)', () => {
    expect(sourceId(gmail('https://mail.google.com/mail/?authuser=a@b.com#all/thread-f:1876500927094397486'))).toBe(BigInt('1876500927094397486').toString(16))
  })
  it('reads a Calendar eid', () => {
    const eid = btoa('abc123 jaime@captiatechnology.com').replace(/=+$/, '')
    expect(sourceId({ app: 'calendar', url: `https://www.google.com/calendar/event?eid=${eid}` })).toBe('abc123')
  })
  it('gives up on links it does not know', () => {
    expect(sourceId(gmail('https://mail.google.com/mail/u/0/#inbox'))).toBeNull()
    expect(sourceId(null)).toBeNull()
  })
})

describe('Cerrar el bucle', () => {
  const thread = (sender: string, date: string, labels: string[] = []) => ({
    id: 'th1',
    viewUrl: 'https://mail.google.com/th1',
    messages: [
      { id: 'm1', sender: 'Yo <jaime@captiatechnology.com>', date: '2026-09-25T09:00:00Z', labelIds: ['SENT'], subject: 'Datos de planta' },
      { id: 'm2', sender, date, labelIds: labels, plaintextBody: 'Adjunto los datos.\n\nEl lun escribió:\n> hola' },
    ],
  })
  const w = { taskId: 'task1', threadId: 'th1', since: Date.parse('2026-09-28T10:00:00Z') }
  const me = new Set(['jaime@captiatechnology.com'])

  it('watches open mail tasks tagged #esperando or found waiting, not the rest', () => {
    const tasks = [
      t({ id: 'a', tags: ['esperando'], source: gmail('u', { id: 'th1' }) }),
      t({ id: 'b', source: gmail('u', { id: 'th2', waiting: true }) }),
      t({ id: 'c', source: gmail('u', { id: 'th3' }) }),
      t({ id: 'd', tags: ['esperando'], status: 'done', source: gmail('u', { id: 'th4' }) }),
      t({ id: 'e', tags: ['esperando'] }),
    ]
    expect(watchedTasks(tasks).map((x) => x.taskId)).toEqual(['a', 'b'])
  })

  it('sees a reply from someone else after the task was written', () => {
    const c = replyCandidate(thread('Ana <ana@elpozo.es>', '2026-09-29T08:00:00Z'), w, me)
    expect(c).toMatchObject({ kind: 'reply', id: 'th1', version: 'm2', taskId: 'task1', body: 'Adjunto los datos.' })
  })

  it('ignores my own messages, old ones and robots', () => {
    expect(replyCandidate(thread('Yo <jaime@captiatechnology.com>', '2026-09-29T08:00:00Z', ['SENT']), w, me)).toBeNull()
    expect(replyCandidate(thread('Ana <ana@elpozo.es>', '2026-09-27T08:00:00Z'), w, me)).toBeNull()
    expect(replyCandidate(thread('noreply@elpozo.es', '2026-09-29T08:00:00Z'), w, me)).toBeNull()
  })

  it('lets the model close only the tasks a reply answered', () => {
    const candidates = [{ kind: 'reply', id: 'th1', version: 'm2', source: 'Gmail', title: '', from: '', when: '', body: '', url: 'https://mail.google.com/th1', taskId: 'task1' }] as Candidate[]
    const ops = finish(
      [
        { op: 'update', id: 't2', status: 'done', text: 'renamed' },
        { op: 'update', id: 't3', status: 'done' },
        { op: 'remove', id: 't2' },
        { op: 'add', text: 'Revisar Excel de El Pozo', notes: 'c1' },
      ],
      candidates,
      new Set(['t2']),
    )
    expect(ops).toEqual([
      { op: 'update', id: 't2', status: 'done' },
      { op: 'add', text: 'Revisar Excel de El Pozo', parent: null, tags: [], due: null, source: { app: 'gmail', url: 'https://mail.google.com/th1', id: 'th1' } },
    ])
  })
})

describe('Borrador listo', () => {
  it('reads the thread oldest first, marks my messages and trims quotes', () => {
    const text = describeThread({
      messages: [
        { sender: 'Ana <ana@elpozo.es>', date: 'lun', subject: 'Oferta', plaintextBody: '¿Me confirmas el jueves?' },
        { sender: 'Jaime', date: 'mar', labelIds: ['SENT'], plaintextBody: 'Hola Ana, lo miro.\n> ¿Me confirmas?' },
      ],
    })
    expect(text).toBe('— Ana <ana@elpozo.es> · lun · Oferta\n¿Me confirmas el jueves?\n\n— Yo · mar\nHola Ana, lo miro.')
  })
})

describe('Preparar reunión', () => {
  const me = new Set(['jaime@captiatechnology.com'])
  const events = [
    { id: 'e2', summary: 'Visita Ubesol', start: { dateTime: '2026-09-30T11:00:00+02:00' }, attendees: [{ email: 'jaime@captiatechnology.com', self: true }, { email: 'Luis@Ubesol.es' }] },
    { id: 'e1', summary: 'Standup', start: { dateTime: '2026-09-30T09:00:00+02:00' }, organizer: { email: 'marta@captiatechnology.com' }, attendees: [{ email: 'jaime@captiatechnology.com', self: true }] },
    { id: 'solo', summary: 'Foco', start: { dateTime: '2026-09-30T13:00:00+02:00' } },
    { id: 'allday', summary: 'Vacaciones', start: { date: '2026-09-30' }, attendees: [{ email: 'x@y.es' }] },
    { id: 'no', summary: 'Rechazada', start: { dateTime: '2026-09-30T16:00:00+02:00' }, attendees: [{ email: 'jaime@captiatechnology.com', self: true, responseStatus: 'declined' }, { email: 'x@y.es' }] },
    { id: 'room', summary: 'Sala', start: { dateTime: '2026-09-30T17:00:00+02:00' }, attendees: [{ email: 'sala1@resource.calendar.google.com' }] },
  ]

  it('keeps meetings with other people, in order', () => {
    const got = meetingsFrom(events, me)
    expect(got.map((m) => m.id)).toEqual(['e1', 'e2'])
    expect(got[1].people).toEqual(['luis@ubesol.es'])
    expect(got[0].people).toEqual(['marta@captiatechnology.com'])
  })

  it('says when in a few characters', () => {
    const [standup] = meetingsFrom(events, me)
    const when = meetingWhen(standup, '2026-09-30')
    expect(when).toMatch(/^\d{2}:\d{2}$/)
    expect(meetingWhen({ ...standup, start: '2026-10-01T09:00:00+02:00' }, '2026-09-30')).toMatch(/^mañana /)
  })

  it('finds the task that already stands for the meeting', () => {
    const [, visit] = meetingsFrom(events, me)
    const eid = btoa('e2 jaime@captiatechnology.com')
    const tasks = [t({ id: 'r', source: { app: 'calendar', url: `https://www.google.com/calendar/event?eid=${eid}` } })]
    expect(meetingTask(tasks, visit)?.id).toBe('r')
  })
})

describe('subjectFrom', () => {
  it('drops the addresses, tags and the verb', async () => {
    const { subjectFrom } = await import('./drafts')
    expect(subjectFrom('Responder a marta@captiatechnology.com sobre la demo Captia #captia')).toBe('La demo Captia')
    expect(subjectFrom('Oferta torno 04 para @luis !')).toBe('Oferta torno 04 para luis')
    expect(subjectFrom('Escribir a ana@x.com')).toBe('Escribir a')
  })
})
