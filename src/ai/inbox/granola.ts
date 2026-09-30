import type { Candidate } from './sources'

/**
 * Granola's connector answers in text: a `<meetings_data>` block with one
 * `<meeting id title date>` per note, its `<known_participants>` and, from
 * `get_meetings`, a `<summary>` and the user's own notes. Pure functions only;
 * reading the connector lives in `connectors.ts`.
 */

export interface Participant {
  name: string
  email: string
  /** The note's author: the user, since these are their own notes. */
  creator: boolean
}

export interface GranolaMeeting {
  id: string
  title: string
  /** As Granola writes it ("Feb 4, 2026 7:30 PM"); `at` is the same, parsed (NaN if it can't be). */
  date: string
  at: number
  participants: Participant[]
  /** Granola's summary plus the user's private notes: what tasks come from. */
  text: string
}

/** What the connector returned, as text: a bare string, `{content: [{type: 'text', text}]}`, or a JSON wrapper. */
export function payloadText(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (!payload || typeof payload !== 'object') return ''
  const p = payload as { content?: { type?: string; text?: string }[]; text?: string; result?: unknown }
  if (Array.isArray(p.content)) return p.content.map((b) => (b?.type === 'text' ? (b.text ?? '') : '')).join('\n')
  if (typeof p.text === 'string') return p.text
  if (p.result !== undefined) return payloadText(p.result)
  return ''
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')

const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`))
  return m ? decode(m[1]).trim() : ''
}

/** "John Doe (note creator) from Acme <john@acme.com>" */
export function parseParticipant(line: string): Participant | null {
  const t = line.trim()
  if (!t) return null
  const email = t.match(/<([^\s<>]+@[^\s<>]+)>/)?.[1]?.toLowerCase() ?? ''
  const creator = /\(note creator\)/i.test(t)
  const name = t
    .replace(/<[^>]*>/g, '')
    .replace(/\(note creator\)/i, '')
    .replace(/\sfrom\s.+$/i, '')
    .trim()
  return name || email ? { name, email, creator } : null
}

const BLOCK = /<(summary|notes|private_notes|enhanced_notes|user_notes|action_items)>([\s\S]*?)<\/\1>/gi

/**
 * Every meeting in the text. `null` when the text isn't Granola's format at
 * all, so a change on their side shows as a problem instead of "nothing new".
 */
export function parseMeetings(text: string): GranolaMeeting[] | null {
  if (!/<meetings_data\b|<meeting\b/.test(text)) return /^\s*$/.test(text) ? [] : null
  const out: GranolaMeeting[] = []
  for (const m of text.matchAll(/<meeting\b([^>]*)>([\s\S]*?)<\/meeting>/g)) {
    const [, attrs, body] = m
    const id = attr(attrs, 'id')
    if (!id) continue
    const date = attr(attrs, 'date')
    const who = body.match(/<known_participants>([\s\S]*?)<\/known_participants>/)?.[1] ?? ''
    const participants = who
      .split('\n')
      .map(parseParticipant)
      .filter((p): p is Participant => p !== null)
    const parts: string[] = []
    for (const b of body.matchAll(BLOCK)) {
      const content = decode(b[2]).trim()
      if (content) parts.push(content)
    }
    out.push({ id, title: attr(attrs, 'title') || '(sin título)', date, at: Date.parse(date), participants, text: parts.join('\n\n') })
  }
  return out
}

/** Whether a meeting says the list has no meetings, as opposed to a format we don't read. */
export const isEmptyList = (text: string) => /<meetings_data\b[^>]*\bcount="0"/.test(text)

/** Where the note opens. Granola's own citations link here. */
export const noteUrl = (id: string) => `https://notes.granola.ai/d/${encodeURIComponent(id)}`

const NOTE_LIMIT = 4000

export function candidatesFromMeetings(meetings: GranolaMeeting[]): Candidate[] {
  const out: Candidate[] = []
  for (const m of meetings) {
    // An empty note is still being taken: it's read on a later check.
    if (!m.text.trim()) continue
    const me = m.participants.find((p) => p.creator)
    const others = m.participants.filter((p) => !p.creator).map((p) => p.name || p.email)
    const body = m.text.length > NOTE_LIMIT ? `${m.text.slice(0, NOTE_LIMIT)}…` : m.text
    out.push({
      kind: 'meeting',
      id: m.id,
      // A note is proposed once: edits after that are the user's to carry over.
      version: 'notas',
      source: 'Granola',
      title: m.title,
      from: [me ? `yo: ${me.name || me.email}` : '', others.length ? `con ${others.join(', ')}` : ''].filter(Boolean).join(' · '),
      when: m.date,
      body,
      url: noteUrl(m.id),
    })
  }
  return out
}

/** Letters and digits only, lowercase and without accents: how a quote is checked against the note. */
export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** The quote is really in the note (ignoring case, accents and punctuation), and long enough to mean something. */
export function quoted(quote: string | undefined, body: string): boolean {
  const q = normalize(quote ?? '')
  return q.split(' ').length >= 2 && normalize(body).includes(q)
}

/** Meetings shared with any of these people (by address), newest first. */
export function meetingsWith(meetings: GranolaMeeting[], people: string[], before: number): GranolaMeeting[] {
  const want = new Set(people.map((p) => p.toLowerCase()))
  return meetings
    .filter((m) => !(m.at >= before) && m.participants.some((p) => !p.creator && want.has(p.email)))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
}

/** Granola notes the sheet already has tasks from (open or done): never proposed again, even from another browser. */
export function knownNotes(tasks: { source?: { app: string; id?: string } | null }[]): Set<string> {
  return new Set(tasks.flatMap((t) => (t.source?.app === 'granola' && t.source.id ? [t.source.id] : [])))
}
