import { seenKey, type Candidate } from './sources'

/**
 * Threads and events already proposed, so each shows up once. Keyed on the
 * last message (or the event's last change): a new reply brings a thread back.
 * Kept in this browser, like the sheet itself; old entries fall off.
 */
const KEY = 'daily-tracking-tool:inbox-seen'
const KEEP_MS = 60 * 86_400_000

type Store = Record<string, number>

function load(): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as Store) : {}
  } catch {
    return {}
  }
}

let cache: Store | null = null

export function isSeen(c: Pick<Candidate, 'id' | 'version'>): boolean {
  cache ??= load()
  return seenKey(c) in cache
}

export function markSeen(keys: string[], now = Date.now()) {
  cache ??= load()
  for (const k of keys) cache[k] = now
  for (const [k, at] of Object.entries(cache)) if (now - at > KEEP_MS) delete cache[k]
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* private mode: remembered until the page closes */
  }
}
