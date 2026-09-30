import { claudeHost } from '../config'
import {
  address,
  candidatesFromEvents,
  candidatesFromThreads,
  dedupe,
  shortlist,
  type CalendarEvent,
  type Candidate,
  type GmailThread,
  type Kind,
} from './sources'

/**
 * Reads the user's Gmail and Google Calendar through their own claude.ai
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

export interface Gathered {
  candidates: Candidate[]
  /** One line per source that couldn't be read, for the user. */
  problems: string[]
}

/**
 * Everything that may hide a task, from both sources. A source that fails
 * doesn't stop the other. `seen` skips threads and events already proposed.
 */
export async function gather(seen: Seen): Promise<Gathered | null> {
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
  const candidates = dedupe([...mails, ...events]).filter((c) => !seen(c))
  return { candidates, problems }
}
