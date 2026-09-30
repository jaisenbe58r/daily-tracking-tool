import { beforeEach, describe, expect, it, vi } from 'vitest'
import { candidatesFromMeetings, knownNotes, meetingsWith, noteUrl, parseMeetings, payloadText, quoted } from './granola'
import { finish } from './extract'
import { describeCandidates, sourceId } from './sources'
import { sanitize } from '../../lib/persist'

// As Granola's connector answers `list_meetings` and `get_meetings` (text, not JSON).
const LIST = `<meetings_data from="Sep 22, 2026" to="Sep 30, 2026" count="2">
<meeting id="0dba4400-50f1-4262-9ac7-89cd27b79371" title="Visita Ubesol" date="Sep 29, 2026 10:00 AM">
    <known_participants>
    Jaime Sendra (note creator) from Captia <jaime@captiatechnology.com>
    Marta Ruiz from Ubesol <marta@ubesol.es>
    </known_participants>
  </meeting>

<meeting id="4ebc086f-ba8d-49e8-8cd1-ed81ac8f2e3b" title="Sync interno" date="Sep 30, 2026 9:00 AM">
    <known_participants>
    Jaime Sendra (note creator) from Captia <jaime@captiatechnology.com>
    </known_participants>
  </meeting>
</meetings_data>`

const DETAIL = `<meetings_data from="Sep 29, 2026" to="Sep 30, 2026" count="2">
<meeting id="0dba4400-50f1-4262-9ac7-89cd27b79371" title="Visita Ubesol" date="Sep 29, 2026 10:00 AM">
  <known_participants>
  Jaime Sendra (note creator) from Captia <jaime@captiatechnology.com>
  Marta Ruiz from Ubesol <marta@ubesol.es>
  </known_participants>
  <summary>
## Decisiones
- Piloto en la línea 2 &amp; la 3

## Action Items
- Jaime envía la oferta revisada el viernes
- @marta: compartir los planos del torno 04
</summary>
</meeting>
<meeting id="4ebc086f-ba8d-49e8-8cd1-ed81ac8f2e3b" title="Sync interno" date="Sep 30, 2026 9:00 AM">
  <known_participants>
  Jaime Sendra (note creator) from Captia <jaime@captiatechnology.com>
  </known_participants>
</meeting>
</meetings_data>`

describe('parseMeetings', () => {
  it('reads ids, titles, dates, participants and notes', () => {
    const out = parseMeetings(DETAIL)!
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ id: '0dba4400-50f1-4262-9ac7-89cd27b79371', title: 'Visita Ubesol', date: 'Sep 29, 2026 10:00 AM' })
    expect(out[0].participants).toEqual([
      { name: 'Jaime Sendra', email: 'jaime@captiatechnology.com', creator: true },
      { name: 'Marta Ruiz', email: 'marta@ubesol.es', creator: false },
    ])
    expect(out[0].text).toContain('Piloto en la línea 2 & la 3')
    expect(out[1].text).toBe('')
  })

  it('tells an unknown format apart from an empty list', () => {
    expect(parseMeetings('Transcripts are only available to paid Granola tiers')).toBeNull()
    expect(parseMeetings('')).toEqual([])
    expect(parseMeetings('<meetings_data count="0"></meetings_data>')).toEqual([])
  })

  it('takes text however the connector wraps it', () => {
    expect(payloadText('hola')).toBe('hola')
    expect(payloadText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('a\nb')
    expect(payloadText({ result: { text: 'c' } })).toBe('c')
    expect(payloadText(null)).toBe('')
  })
})

describe('candidatesFromMeetings', () => {
  it('one candidate per note with content, linked to the note; empty notes wait', () => {
    const out = candidatesFromMeetings(parseMeetings(DETAIL)!)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'meeting', source: 'Granola', id: '0dba4400-50f1-4262-9ac7-89cd27b79371', version: 'notas', url: noteUrl('0dba4400-50f1-4262-9ac7-89cd27b79371'), from: 'yo: Jaime Sendra · con Marta Ruiz' })
    expect(describeCandidates(out)).toContain('[c1] Granola · notas de tu reunión')
  })
})

describe('finish with meeting notes', () => {
  const cands = candidatesFromMeetings(parseMeetings(DETAIL)!)

  it('keeps a task only when its quote is really in the note, and keeps the quote', () => {
    const report = { dropped: 0 }
    const ops = finish(
      [
        { op: 'add', text: 'Enviar oferta revisada a Ubesol', notes: 'c1 «Jaime envía la oferta revisada el viernes»', due: '2026-10-02' },
        { op: 'add', text: 'Preparar demo línea 2', notes: 'c1 «Jaime prepara la demo de la línea 2»' },
        { op: 'add', text: 'Llamar a Marta', notes: 'c1' },
      ],
      cands,
      new Set(),
      { report },
    )
    expect(ops).toEqual([
      {
        op: 'add',
        text: 'Enviar oferta revisada a Ubesol',
        parent: null,
        tags: [],
        due: '2026-10-02',
        source: { app: 'granola', url: noteUrl(cands[0].id), id: cands[0].id, quote: 'Jaime envía la oferta revisada el viernes' },
      },
    ])
    expect(report.dropped).toBe(2)
  })

  it('a quote matches whatever the case, accents or punctuation', () => {
    expect(quoted('jaime envia la oferta revisada, el viernes', cands[0].body)).toBe(true)
    expect(quoted('oferta', cands[0].body)).toBe(false)
  })

  it('never proposes the same task twice: not an open one, not twice in one go', () => {
    const ops = finish(
      [
        { op: 'add', text: 'Enviar oferta revisada', notes: 'c1 «Jaime envía la oferta revisada»' },
        { op: 'add', text: 'Enviar  oferta revisada.', notes: 'c1 «envía la oferta revisada el viernes»' },
        { op: 'add', text: 'Revisar alarmas', notes: 'c1 «Piloto en la línea 2»' },
      ],
      cands,
      new Set(),
      { open: ['Revisar alarmas'] },
    )
    expect(ops.map((o) => o.text)).toEqual(['Enviar oferta revisada'])
  })
})

describe('knownNotes and meetingsWith', () => {
  it('notes the sheet already has tasks from are known', () => {
    const tasks = [{ source: { app: 'granola', url: noteUrl('n1'), id: 'n1' } }, { source: { app: 'gmail', url: 'https://x', id: 'g' } }, {}]
    expect([...knownNotes(tasks)]).toEqual(['n1'])
    expect(sourceId({ app: 'granola', url: noteUrl('n2') })).toBe('n2')
  })

  it('a task from a note keeps its link and quote across reloads', () => {
    const [t] = sanitize([{ id: 'a', text: 'x', source: { app: 'granola', url: noteUrl('n1'), id: 'n1', quote: 'envía la oferta' } }])
    expect(t.source).toEqual({ app: 'granola', url: noteUrl('n1'), id: 'n1', quote: 'envía la oferta' })
  })

  it('earlier meetings shared with someone, newest first', () => {
    const list = parseMeetings(LIST)!
    expect(meetingsWith(list, ['marta@ubesol.es'], Date.parse('2026-10-01')).map((m) => m.title)).toEqual(['Visita Ubesol'])
    expect(meetingsWith(list, ['marta@ubesol.es'], Date.parse('2026-09-28'))).toEqual([])
  })
})

// Reading through the connector: what reaches Recoger, and what the user is told when it can't.
const calls: { server: string; tool: string; input: unknown }[] = []
let granolaReply: (tool: string, input: { meeting_ids?: string[] }) => unknown = () => ''
vi.mock('../config', () => ({
  claudeHost: () => ({
    use: async () => ({
      callTool: async (server: string, tool: string, input: { meeting_ids?: string[] }) => {
        calls.push({ server, tool, input })
        if (server !== 'Granola') return { payload: server === 'Gmail' ? { threads: [] } : { events: [] } }
        return { payload: granolaReply(tool, input) }
      },
    }),
  }),
}))

describe('gather from Granola', () => {
  beforeEach(() => {
    calls.length = 0
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-30T14:00:00Z'))
  })

  it('reads only notes not seen nor already on the sheet, and proposes those with content', async () => {
    const { gather } = await import('./connectors')
    granolaReply = (tool) => (tool === 'list_meetings' ? { content: [{ type: 'text', text: LIST }] } : DETAIL)
    const got = await gather(() => false, [], new Set(['4ebc086f-ba8d-49e8-8cd1-ed81ac8f2e3b']))
    expect(got!.problems).toEqual([])
    expect(got!.candidates.map((c) => c.title)).toEqual(['Visita Ubesol'])
    const read = calls.find((c) => c.tool === 'get_meetings')!
    expect(read.input).toEqual({ meeting_ids: ['0dba4400-50f1-4262-9ac7-89cd27b79371'] })
    expect(calls.find((c) => c.tool === 'list_meetings')!.input).toEqual({ time_range: 'custom', custom_start: '2026-09-16', custom_end: '2026-10-01' })
  })

  it('an answer it cannot read is a problem, not "nothing new"', async () => {
    const { gather } = await import('./connectors')
    granolaReply = () => 'Something changed on our side'
    const got = await gather(() => false)
    expect(got!.candidates).toEqual([])
    expect(got!.problems).toEqual(['Granola respondió algo que no sé leer: no he propuesto nada de ahí'])
  })

  it('a connector that is not connected says how to fix it', async () => {
    const { gather } = await import('./connectors')
    granolaReply = () => {
      throw Object.assign(new Error('x'), { code: 'server_not_connected' })
    }
    const got = await gather(() => false)
    expect(got!.problems).toEqual(['Conecta Granola en claude.ai (Ajustes → Conectores)'])
  })
})
