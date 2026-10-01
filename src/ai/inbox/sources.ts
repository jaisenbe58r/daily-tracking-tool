/**
 * Turns what Gmail and Google Calendar return into candidates: things that
 * may hide a task for the user. Pure functions only, so the rules are easy to
 * test; reading the connectors lives in `connectors.ts`.
 */

export type Kind = 'ask' | 'starred' | 'waiting' | 'invite' | 'reply' | 'followup' | 'meeting'

export interface Candidate {
  kind: Kind
  /** Thread or event id. With `version`, what "already seen" is keyed on. */
  id: string
  /** Last message id, or when the event last changed: a new reply brings a thread back. */
  version: string
  source: 'Gmail' | 'Calendar' | 'Granola'
  title: string
  /** Who wrote last, who organizes the meeting, or who was in it. */
  from: string
  /** ISO date of the last message, the event's start, or when the meeting was. */
  when: string
  /** What the model reads: the last message (trimmed), the event's details, or the meeting's notes. */
  body: string
  url: string
  /** `reply`, `followup`: the open task (its id) this news may close. */
  taskId?: string
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
  end?: { dateTime?: string; date?: string }
  /** `transparent`: the event doesn't block the time. */
  transparency?: string
  organizer?: { email?: string; self?: boolean }
  attendees?: { email?: string; self?: boolean; responseStatus?: string }[]
}

const DAY = 86_400_000
const BODY_LIMIT = 1200

/** Mail no person wrote: nothing to answer there. Granola's recaps too: the note itself is read. */
const AUTOMATED = /(no-?reply|do-?not-?reply|notifications?@|mailer-daemon|postmaster|calendar-notification|bounce|newsletter|news@|info@|marketing|granola)/i
/** Invitations and RSVPs come by mail too, but the calendar already covers them. */
const CALENDAR_MAIL = /^(invitaci[oó]n|invitation|invitaci[oó]n actualizada|updated invitation|aceptad[oa]|accepted|rechazad[oa]|declined|tentativ|evento cancelado|canceled event|cancelled event)\b/i

export const address = (value: string | undefined) => (value?.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? value ?? '').toLowerCase()
const isMe = (value: string | undefined, me: Set<string>) => me.has(address(value))
const lastOf = <T>(list: T[] | undefined): T | undefined => list?.[list.length - 1]

function isCalendarMail(m: GmailMessage): boolean {
  if (m.attachments?.some((a) => /calendar|ics/i.test(a.mimeType ?? '') || /\.ics$/i.test(a.filename ?? ''))) return true
  return CALENDAR_MAIL.test((m.subject ?? '').trim())
}

/** Where the quoted history of a reply starts. */
export const QUOTE_START = /^(On .+wrote:|El .+escribi[oó]:|-{2,}\s*(Original Message|Mensaje original)|De: .+|From: .+|________________)/i

/** The new part of a reply: quoted history, signatures and legal footers go. */
export function cleanBody(text: string): string {
  const lines: string[] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const t = line.trim()
    if (QUOTE_START.test(t)) break
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
  reply: 'respuesta a tu tarea',
  followup: 'novedad en el hilo de tu tarea',
  meeting: 'notas de tu reunión',
}

/** How the model reads the candidates: `c1`, `c2`… are what it cites back in `notes`. `refOf` names the tasks replies answer. */
export function describeCandidates(list: Candidate[], refOf: Map<string, string> = new Map()): string {
  return list
    .map((c, i) =>
      [
        `[c${i + 1}] ${c.source} · ${KIND_LABEL[c.kind]}${c.taskId && refOf.has(c.taskId) ? ` ${refOf.get(c.taskId)}` : ''} · ${c.when}`,
        `Asunto: ${c.title}`,
        `De: ${c.from}`,
        c.body ? `Texto:\n${c.body}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n')
}

/**
 * The Gmail thread or Calendar event behind a task. Newer tasks carry the id;
 * older ones only have the link: Gmail's `thread-f:<decimal>` is the thread id
 * in hex, and Calendar's `eid` is base64 of "<event id> <calendar>".
 */
export function sourceId(source: { app: 'gmail' | 'calendar' | 'granola'; url: string; id?: string } | null | undefined): string | null {
  if (!source) return null
  if (source.id) return source.id
  if (source.app === 'granola') return source.url.match(/\/d\/([^/?#]+)/)?.[1] ?? null
  if (source.app === 'gmail') {
    const m = source.url.match(/thread-f:(\d+)/)
    if (!m) return null
    try {
      return BigInt(m[1]).toString(16)
    } catch {
      return null
    }
  }
  const eid = source.url.match(/[?&]eid=([^&#]+)/)?.[1]
  if (!eid) return null
  try {
    const decoded = atob(decodeURIComponent(eid).replace(/-/g, '+').replace(/_/g, '/'))
    return decoded.split(' ')[0] || null
  } catch {
    return null
  }
}

/** An open task from a mail, whose thread may since have moved: answered, solved, or a reply that closes it. */
export interface Watched {
  taskId: string
  threadId: string
  /** Replies before this (ms) were already there when the task was written. */
  since: number
  /** Waits on someone (#esperando, or found as "esperas respuesta"): only their answer counts. */
  waiting: boolean
}

/** Every open task from a Gmail thread, the ones waiting on someone first, then the newest. */
export function watchedTasks(tasks: { id: string; status: string; tags: string[]; createdAt: number; source?: { app: 'gmail' | 'calendar' | 'granola'; url: string; id?: string; waiting?: boolean } | null }[]): Watched[] {
  const out: Watched[] = []
  for (const t of tasks) {
    if (t.status === 'done' || t.source?.app !== 'gmail') continue
    const threadId = sourceId(t.source)
    if (threadId) out.push({ taskId: t.id, threadId, since: t.createdAt, waiting: t.tags.includes('esperando') || Boolean(t.source.waiting) })
  }
  return out.sort((a, b) => Number(b.waiting) - Number(a.waiting) || b.since - a.since)
}

/** Messages in the thread kept for a follow-up: the newest few written after the task. */
const FOLLOWUP_MESSAGES = 3

/**
 * The thread behind a task moved after the task was written: maybe it's done.
 * Waiting: someone other than the user answered. Otherwise any person wrote,
 * the user included (they may have replied already, outside the sheet).
 */
export function replyCandidate(thread: GmailThread, w: Watched, me: Set<string>): Candidate | null {
  const msgs = thread.messages ?? []
  const last = lastOf(msgs)
  if (!thread.id || !last?.id) return null
  const mine = (m: GmailMessage) => Boolean(m.labelIds?.includes('SENT')) || isMe(m.sender, me)
  const after = (m: GmailMessage) => Date.parse(m.date ?? '') > w.since
  if (!after(last) || AUTOMATED.test(last.sender ?? '')) return null
  if (w.waiting && mine(last)) return null
  const subject = (msgs.find((m) => m.subject)?.subject ?? '(sin asunto)').trim()
  if (w.waiting) {
    return { kind: 'reply', id: thread.id, version: last.id, source: 'Gmail', title: subject, from: last.sender ?? '', when: last.date ?? '', body: cleanBody(last.plaintextBody ?? last.snippet ?? ''), url: thread.viewUrl ?? '', taskId: w.taskId }
  }
  const news = msgs.filter((m) => after(m) && !AUTOMATED.test(m.sender ?? '')).slice(-FOLLOWUP_MESSAGES)
  const who = (m: GmailMessage) => (mine(m) ? 'yo' : (m.sender ?? ''))
  return {
    kind: 'followup',
    id: thread.id,
    version: last.id,
    source: 'Gmail',
    title: subject,
    from: news.map(who).join(', '),
    when: last.date ?? '',
    body: news.map((m) => `${who(m)}: ${cleanBody(m.plaintextBody ?? m.snippet ?? '')}`).join('\n\n'),
    url: thread.viewUrl ?? '',
    taskId: w.taskId,
  }
}

/** Everyone in a thread but the user (and robots), as plain addresses, first seen first. */
export function participants(thread: GmailThread, me: Set<string>): string[] {
  const all = (thread.messages ?? []).flatMap((m) => [m.sender, ...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])])
  return [...new Set(all.filter((v): v is string => Boolean(v) && !AUTOMATED.test(v!)).map(address))].filter((a) => a.includes('@') && !me.has(a))
}

/**
 * Who a reply to the thread goes to: whoever wrote last (or, if it was the user,
 * the people they wrote to), the rest in copy. `me` grows with the thread's own
 * sent messages, so it works even before the user's address is known.
 */
export function replyHeaders(thread: GmailThread, me: Set<string>): { to: string[]; cc: string[]; subject: string; replyToMessageId?: string } {
  const msgs = thread.messages ?? []
  const self = new Set(me)
  for (const m of msgs) if (m.labelIds?.includes('SENT') && m.sender) self.add(address(m.sender))
  const last = lastOf(msgs)
  const subject = (msgs.find((m) => m.subject)?.subject ?? '').trim()
  const clean = (list: (string | undefined)[]) => [...new Set(list.filter((v): v is string => Boolean(v)).map(address))].filter((a) => a.includes('@') && !self.has(a))
  if (!last) return { to: [], cc: [], subject }
  const mine = self.has(address(last.sender))
  const to = mine ? clean(last.toRecipients ?? []) : clean([last.sender])
  const cc = clean([...(mine ? [] : (last.toRecipients ?? [])), ...(last.ccRecipients ?? [])]).filter((a) => !to.includes(a))
  return { to, cc, subject: !subject || /^(re|rv|fw|fwd)\s*:/i.test(subject) ? subject : `Re: ${subject}`, ...(last.id ? { replyToMessageId: last.id } : {}) }
}
