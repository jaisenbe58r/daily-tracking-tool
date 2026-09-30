/**
 * Turns what Gmail and Google Calendar return into candidates: things that
 * may hide a task for the user. Pure functions only, so the rules are easy to
 * test; reading the connectors lives in `connectors.ts`.
 */

export type Kind = 'ask' | 'starred' | 'waiting' | 'invite'

export interface Candidate {
  kind: Kind
  /** Thread or event id. With `version`, what "already seen" is keyed on. */
  id: string
  /** Last message id, or when the event last changed: a new reply brings a thread back. */
  version: string
  source: 'Gmail' | 'Calendar'
  title: string
  /** Who wrote last, or who organizes the meeting. */
  from: string
  /** ISO date of the last message, or the event's start. */
  when: string
  /** What the model reads: the last message (trimmed), or the event's details. */
  body: string
  url: string
}

export const seenKey = (c: Pick<Candidate, 'id' | 'version'>) => `${c.id}@${c.version}`

// Shapes as the connectors return them; everything optional, since nothing here is guaranteed.
export interface GmailMessage {
  id?: string
  sender?: string
  toRecipients?: string[]
  ccRecipients?: string[]
  date?: string
  labelIds?: string[]
  subject?: string
  snippet?: string
  plaintextBody?: string
  attachments?: { mimeType?: string; filename?: string }[]
}
export interface GmailThread {
  id?: string
  messages?: GmailMessage[]
  viewUrl?: string
}
export interface CalendarEvent {
  id?: string
  summary?: string
  description?: string
  status?: string
  updated?: string
  htmlLink?: string
  start?: { dateTime?: string; date?: string }
  organizer?: { email?: string; self?: boolean }
  attendees?: { email?: string; self?: boolean; responseStatus?: string }[]
}

const DAY = 86_400_000
const BODY_LIMIT = 1200

/** Mail no person wrote: nothing to answer there. */
const AUTOMATED = /(no-?reply|do-?not-?reply|notifications?@|mailer-daemon|postmaster|calendar-notification|bounce|newsletter|news@|info@|marketing)/i
/** Invitations and RSVPs come by mail too, but the calendar already covers them. */
const CALENDAR_MAIL = /^(invitaci[oó]n|invitation|invitaci[oó]n actualizada|updated invitation|aceptad[oa]|accepted|rechazad[oa]|declined|tentativ|evento cancelado|canceled event|cancelled event)\b/i

export const address = (value: string | undefined) => (value?.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? value ?? '').toLowerCase()
const isMe = (value: string | undefined, me: Set<string>) => me.has(address(value))
const lastOf = <T>(list: T[] | undefined): T | undefined => list?.[list.length - 1]

function isCalendarMail(m: GmailMessage): boolean {
  if (m.attachments?.some((a) => /calendar|ics/i.test(a.mimeType ?? '') || /\.ics$/i.test(a.filename ?? ''))) return true
  return CALENDAR_MAIL.test((m.subject ?? '').trim())
}

/** The new part of a reply: quoted history, signatures and legal footers go. */
export function cleanBody(text: string): string {
  const lines: string[] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const t = line.trim()
    if (/^(On .+wrote:|El .+escribi[oó]:|-{2,}\s*(Original Message|Mensaje original)|De: .+|From: .+|________________)/i.test(t)) break
    if (t.startsWith('>')) continue
    if (t === '--' || t === '-- ') break
    lines.push(line)
  }
  const out = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return out.length > BODY_LIMIT ? `${out.slice(0, BODY_LIMIT)}…` : out
}

/**
 * Threads worth reading in full. Search results carry at most the first five
 * messages of a thread, so this is a first cut: `candidatesFromThreads` decides
 * again once the whole thread is in.
 */
export function shortlist(threads: GmailThread[], me: Set<string>, kind: Kind, now: number): GmailThread[] {
  return threads.filter((t) => {
    const msgs = t.messages ?? []
    const last = lastOf(msgs)
    if (!t.id || !last) return false
    if (kind === 'starred') return true
    if (msgs.length >= 5) return true // may have newer messages the preview doesn't show
    return keep(kind, msgs, me, now)
  })
}

function keep(kind: Kind, msgs: GmailMessage[], me: Set<string>, now: number): boolean {
  const last = lastOf(msgs)
  if (!last) return false
  if (kind === 'starred') return true
  if (msgs.some(isCalendarMail)) return false
  const mine = isMe(last.sender, me)
  if (kind === 'ask') {
    // Someone else spoke last, a person, and wrote to the user directly (not only in copy).
    return !mine && !AUTOMATED.test(last.sender ?? '') && (last.toRecipients ?? []).some((r) => isMe(r, me))
  }
  // waiting: the user spoke last, to someone else, between two and ten days ago.
  const age = now - Date.parse(last.date ?? '')
  const others = [...(last.toRecipients ?? [])].filter((r) => !isMe(r, me))
  return mine && others.length > 0 && age >= 2 * DAY && age <= 10 * DAY
}

/** Full threads in, candidates out. */
export function candidatesFromThreads(threads: GmailThread[], me: Set<string>, kind: Kind, now: number): Candidate[] {
  const out: Candidate[] = []
  for (const t of threads) {
    const msgs = t.messages ?? []
    const last = lastOf(msgs)
    if (!t.id || !last?.id || !keep(kind, msgs, me, now)) continue
    const subject = (msgs.find((m) => m.subject)?.subject ?? '(sin asunto)').trim()
    const to = kind === 'waiting' ? ` · para ${(last.toRecipients ?? []).filter((r) => !isMe(r, me)).join(', ')}` : ''
    out.push({
      kind,
      id: t.id,
      version: last.id,
      source: 'Gmail',
      title: subject,
      from: `${last.sender ?? ''}${to}`,
      when: last.date ?? '',
      body: cleanBody(last.plaintextBody ?? last.snippet ?? ''),
      url: t.viewUrl ?? '',
    })
  }
  return out
}

/** Meetings in the coming days that still wait for the user's answer. */
export function candidatesFromEvents(events: CalendarEvent[], me: Set<string>): Candidate[] {
  const out: Candidate[] = []
  for (const e of events) {
    if (!e.id || e.status === 'cancelled') continue
    const self = e.attendees?.find((a) => a.self || isMe(a.email, me))
    if (!self || self.responseStatus !== 'needsAction' || e.organizer?.self || isMe(e.organizer?.email, me)) continue
    const description = (e.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    out.push({
      kind: 'invite',
      id: e.id,
      version: e.updated ?? '',
      source: 'Calendar',
      title: (e.summary ?? '(sin título)').trim(),
      from: e.organizer?.email ?? '',
      when: e.start?.dateTime ?? e.start?.date ?? '',
      body: description.length > 300 ? `${description.slice(0, 300)}…` : description,
      url: e.htmlLink ?? '',
    })
  }
  return out
}

/** One thread can show up as starred and as a question: keep the first reading. */
export function dedupe(list: Candidate[]): Candidate[] {
  const seen = new Set<string>()
  return list.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
}

const KIND_LABEL: Record<Kind, string> = {
  ask: 'te escriben a ti',
  starred: 'destacado por ti',
  waiting: 'esperas respuesta',
  invite: 'invitación sin responder',
}

/** How the model reads the candidates: `c1`, `c2`… are what it cites back in `notes`. */
export function describeCandidates(list: Candidate[]): string {
  return list
    .map((c, i) =>
      [
        `[c${i + 1}] ${c.source} · ${KIND_LABEL[c.kind]} · ${c.when}`,
        `Asunto: ${c.title}`,
        `De: ${c.from}`,
        c.body ? `Texto:\n${c.body}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n')
}
