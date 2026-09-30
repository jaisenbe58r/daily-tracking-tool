import { claudeHost } from '../config'
import {
  address,
  candidatesFromEvents,
  candidatesFromThreads,
  dedupe,
  replyCandidate,
  shortlist,
  type CalendarEvent,
  type Candidate,
  type GmailThread,
  type Kind,
  type Watched,
} from './sources'
import { candidatesFromMeetings, isEmptyList, meetingsWith, parseMeetings, payloadText, type GranolaMeeting } from './granola'

/**
 * Reads the user's Gmail, Google Calendar and Granola through their own claude.ai
 * connectors: the page never sees a token, claude.ai asks once per connector,
 * and only read tools are declared (see the publish manifest in the README).
 * Outside claude.ai there is no way in, and `connectors()` says so with null.
 */
interface Mcp {
  callTool(server: string, tool: string, input?: unknown, options?: { cache?: false }): Promise<{ payload?: unknown }>
}
interface McpError {
  code?: string
}

export const GMAIL = 'Gmail'
export const CALENDAR = 'Google Calendar'
export const GRANOLA = 'Granola'

let mcp: Promise<Mcp | null> | null = null
export function connectors(): Promise<Mcp | null> {
  mcp ??= claudeHost()?.use('mcp').then((m) => (m as Mcp) ?? null, () => null) ?? Promise.resolve(null)
  return mcp
}

/** Why a source gave nothing, in words the user can act on. */
export function sourceProblem(server: string, error: unknown): string {
  const code = (error as McpError)?.code
  if (code === 'needs_reauth') return `Vuelve a conectar ${server} en claude.ai (Ajustes → Conectores)`
  if (code === 'server_not_connected' || code === 'selection_required') return `Conecta ${server} en claude.ai (Ajustes → Conectores)`
  if (code === 'not_in_manifest' || code === 'not_granted') return `Esta página no tiene permiso para leer ${server}`
  if (code === 'unreadable') return `${server} respondió algo que no sé leer: no he propuesto nada de ahí`
  return `${server} no respondió`
}

async function call<T>(m: Mcp, server: string, tool: string, input: unknown): Promise<T> {
  const res = await m.callTool(server, tool, input, { cache: false })
  return (res.payload ?? {}) as T
}

/** At most `limit` calls in flight: a connector is shared with the user's other tabs. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** Already proposed, as far as the preview can tell (it shows only the first five messages). */
function previewSeen(t: GmailThread, seen: Seen): boolean {
  const msgs = t.messages ?? []
  const last = msgs[msgs.length - 1]
  return Boolean(t.id && last?.id && msgs.length < 5 && seen({ id: t.id, version: last.id }))
}

const SEARCHES: { kind: Kind; query: string; pageSize: number }[] = [
  { kind: 'ask', query: 'in:inbox newer_than:7d -from:me -category:promotions -category:social -category:forums', pageSize: 50 },
  { kind: 'starred', query: 'is:starred newer_than:60d', pageSize: 20 },
  { kind: 'waiting', query: 'in:sent newer_than:10d older_than:2d', pageSize: 30 },
]
/** Threads read in full per check. The rest waits for the next one. */
const MAX_THREADS = 30

type Seen = (c: Pick<Candidate, 'id' | 'version'>) => boolean

async function gmail(m: Mcp, me: Set<string>, now: number, seen: Seen): Promise<Candidate[]> {
  const found = await Promise.all(
    SEARCHES.map(async ({ kind, query, pageSize }) => {
      const { threads = [] } = await call<{ threads?: GmailThread[] }>(m, GMAIL, 'search_threads', { query, pageSize, view: 'THREAD_VIEW_MINIMAL' })
      return { kind, threads }
    }),
  )
  // The user's own address: the sender of anything they sent.
  for (const { kind, threads } of found)
    if (kind === 'waiting') for (const t of threads) for (const msg of t.messages ?? []) if (msg.sender && msg.labelIds?.includes('SENT')) me.add(address(msg.sender))
  if (!me.size) {
    const { threads = [] } = await call<{ threads?: GmailThread[] }>(m, GMAIL, 'search_threads', { query: 'in:sent', pageSize: 1, view: 'THREAD_VIEW_METADATA_ONLY' })
    const sent = threads[0]?.messages?.find((msg) => msg.labelIds?.includes('SENT'))
    if (sent?.sender) me.add(address(sent.sender))
  }

  const wanted: { kind: Kind; id: string }[] = []
  const taken = new Set<string>()
  for (const { kind, threads } of found)
    for (const t of shortlist(threads, me, kind, now))
      if (t.id && !taken.has(t.id) && !previewSeen(t, seen)) {
        taken.add(t.id)
        wanted.push({ kind, id: t.id })
      }

  const full = await pool(wanted.slice(0, MAX_THREADS), 4, async ({ kind, id }) => {
    const thread = await call<GmailThread>(m, GMAIL, 'get_thread', { threadId: id, messageFormat: 'PLAIN_TEXT' }).catch(() => null)
    return thread ? candidatesFromThreads([thread], me, kind, now) : []
  })
  return full.flat()
}

async function calendar(m: Mcp, me: Set<string>, now: number): Promise<Candidate[]> {
  const payload = await call<{ events?: CalendarEvent[]; summary?: string }>(m, CALENDAR, 'list_events', {
    startTime: new Date(now).toISOString(),
    endTime: new Date(now + 7 * 86_400_000).toISOString(),
    orderBy: 'startTime',
    pageSize: 100,
  })
  // The primary calendar is named after its owner's address.
  if (payload.summary?.includes('@')) me.add(address(payload.summary))
  return candidatesFromEvents(payload.events ?? [], me)
}

/** Granola answers in text; anything else than its meeting list is a problem to show, not "nothing new". */
function meetingsIn(payload: unknown): GranolaMeeting[] {
  const text = payloadText(payload)
  const meetings = parseMeetings(text)
  if (meetings === null || (!meetings.length && text.trim() && !isEmptyList(text))) throw Object.assign(new Error('unreadable'), { code: 'unreadable' })
  return meetings
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

async function listMeetings(m: Mcp, from: number, to: number): Promise<GranolaMeeting[]> {
  const payload = (await m.callTool(GRANOLA, 'list_meetings', { time_range: 'custom', custom_start: isoDay(from), custom_end: isoDay(to) }, { cache: false })).payload
  return meetingsIn(payload)
}

/** Notes (summary and the user's own) of these meetings, ten per call as Granola allows. */
async function readMeetings(m: Mcp, ids: string[]): Promise<GranolaMeeting[]> {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10))
  const read = await pool(chunks, 2, async (meeting_ids) => meetingsIn((await m.callTool(GRANOLA, 'get_meetings', { meeting_ids }, { cache: false })).payload))
  return read.flat()
}

/** Meeting notes of the last two weeks not proposed yet. A note still empty waits for a later check. */
async function granola(m: Mcp, now: number, seen: Seen, known: Set<string>): Promise<Candidate[]> {
  const listed = await listMeetings(m, now - GRANOLA_DAYS * DAY_MS, now + DAY_MS)
  const fresh = listed
    .filter((x) => !(x.at > now) && !known.has(x.id) && !seen({ id: x.id, version: 'notas' }))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, MAX_MEETINGS)
  if (!fresh.length) return []
  const read = new Map((await readMeetings(m, fresh.map((x) => x.id))).map((x) => [x.id, x]))
  // Keep the list's order and participants when the details leave them out.
  return candidatesFromMeetings(fresh.map((x) => read.get(x.id)).filter((x): x is GranolaMeeting => Boolean(x)).map((x) => ({ ...x, participants: x.participants.length ? x.participants : (listed.find((l) => l.id === x.id)?.participants ?? []) })))
}
const DAY_MS = 86_400_000
const GRANOLA_DAYS = 14
/** Notes read in full per check. The rest waits for the next one. */
const MAX_MEETINGS = 20

/** Threads the user is waiting on, read again: did someone answer since the task was written? */
async function replies(m: Mcp, me: Set<string>, watched: Watched[]): Promise<Candidate[]> {
  const found = await pool(watched.slice(0, MAX_WATCHED), 4, async (w) => {
    const thread = await call<GmailThread>(m, GMAIL, 'get_thread', { threadId: w.threadId, messageFormat: 'PLAIN_TEXT' }).catch(() => null)
    return thread ? replyCandidate(thread, w, me) : null
  })
  return found.filter((c): c is Candidate => c !== null)
}
const MAX_WATCHED = 15

export interface Gathered {
  candidates: Candidate[]
  /** One line per source that couldn't be read, for the user. */
  problems: string[]
}

/**
 * Everything that may hide a task, from every source. A source that fails
 * doesn't stop the others. `seen` skips threads, events and notes already
 * proposed; `known` are the sources tasks on the sheet already came from.
 */
export async function gather(seen: Seen, watched: Watched[] = [], known: Set<string> = new Set()): Promise<Gathered | null> {
  const m = await connectors()
  if (!m) return null
  const now = Date.now()
  const me = new Set<string>()
  const problems: string[] = []
  // Calendar first: it tells who the user is, which Gmail's rules need.
  const events = await calendar(m, me, now).catch((error) => {
    problems.push(sourceProblem(CALENDAR, error))
    return []
  })
  const mails = await gmail(m, me, now, seen).catch((error) => {
    problems.push(sourceProblem(GMAIL, error))
    return []
  })
  const notes = await granola(m, now, seen, known).catch((error) => {
    problems.push(sourceProblem(GRANOLA, error))
    return []
  })
  // Replies first: a thread that answers a waiting task is that, not a new question.
  const answers = await replies(m, me, watched).catch(() => [])
  const candidates = dedupe([...answers, ...mails, ...events, ...notes]).filter((c) => !seen(c))
  return { candidates, problems }
}

/** One Gmail thread, whole, for a draft. Null outside claude.ai or when it can't be read. */
export async function readThread(threadId: string): Promise<GmailThread | null> {
  const m = await connectors()
  if (!m) return null
  return call<GmailThread>(m, GMAIL, 'get_thread', { threadId, messageFormat: 'PLAIN_TEXT' }).catch(() => null)
}

/** Events between two instants, from the primary calendar, and the calendar's owner (the user's address). */
export async function readEvents(from: number, to: number): Promise<{ events: CalendarEvent[]; me: string | null } | null> {
  const m = await connectors()
  if (!m) return null
  const payload = await call<{ events?: CalendarEvent[]; summary?: string }>(m, CALENDAR, 'list_events', {
    startTime: new Date(from).toISOString(),
    endTime: new Date(to).toISOString(),
    orderBy: 'startTime',
    pageSize: 50,
  })
  return { events: payload.events ?? [], me: payload.summary?.includes('@') ? address(payload.summary) : null }
}

/** Recent threads with some people (subject, who, when, a snippet): what a meeting brief draws on. */
export async function mailWith(people: string[], days = 45): Promise<GmailThread[]> {
  const m = await connectors()
  if (!m || !people.length) return []
  const who = people.slice(0, 8).map((p) => `from:${p} OR to:${p}`).join(' OR ')
  const { threads = [] } = await call<{ threads?: GmailThread[] }>(m, GMAIL, 'search_threads', {
    query: `newer_than:${days}d (${who})`,
    pageSize: 10,
    view: 'THREAD_VIEW_MINIMAL',
  }).catch(() => ({ threads: [] as GmailThread[] }))
  return threads
}

/** Up to three earlier Granola notes with any of these people, newest first. Empty when Granola can't be read. */
export async function notesWith(people: string[], before: number, days = 60): Promise<GranolaMeeting[]> {
  const m = await connectors()
  if (!m || !people.length) return []
  try {
    const shared = meetingsWith(await listMeetings(m, before - days * DAY_MS, before), people, before).slice(0, 3)
    if (!shared.length) return []
    const read = await readMeetings(m, shared.map((x) => x.id))
    return shared.map((x) => read.find((r) => r.id === x.id) ?? x)
  } catch {
    return []
  }
}
