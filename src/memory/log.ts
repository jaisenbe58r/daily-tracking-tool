import { useCallback, useEffect, useRef, useState } from 'react'
import type { Task } from '../lib/types'

/**
 * The sheet stores state; this is its history. An append-only record of what
 * happened to each task (the `log.md` of Karpathy's LLM Wiki), kept in
 * IndexedDB next to the tasks. Events are derived by comparing two snapshots
 * of the sheet, so no action has to remember to write them.
 */
export type EventKind = 'create' | 'doing' | 'done' | 'reopen' | 'snooze' | 'move' | 'remove'

export interface LogEvent {
  at: number
  id: string
  kind: EventKind
  /** The task's text when it was written or deleted, so history outlives the task. */
  text?: string
}

const KINDS: EventKind[] = ['create', 'doing', 'done', 'reopen', 'snooze', 'move', 'remove']

/** What changed between two snapshots of the sheet, as events stamped `at`. */
export function diffEvents(prev: Task[], next: Task[], at: number): LogEvent[] {
  const before = new Map(prev.map((t) => [t.id, t]))
  const events: LogEvent[] = []
  for (const task of next) {
    const old = before.get(task.id)
    before.delete(task.id)
    const text = task.text.trim()
    // A task is born when its line first gets words, not when the empty row appears.
    if (!old?.text.trim()) {
      if (text) events.push({ at, id: task.id, kind: 'create', text })
      if (!text || !old) continue
    }
    if (!old || !text) continue
    if (old.status !== task.status) {
      const kind: EventKind = task.status === 'done' ? 'done' : old.status === 'done' ? 'reopen' : task.status === 'doing' ? 'doing' : 'reopen'
      events.push({ at, id: task.id, kind })
    }
    if (task.snooze && (task.snooze.until !== old.snooze?.until)) events.push({ at, id: task.id, kind: 'snooze' })
    if (old.parentId !== task.parentId) events.push({ at, id: task.id, kind: 'move' })
  }
  for (const gone of before.values()) {
    const text = gone.text.trim()
    if (text) events.push({ at, id: gone.id, kind: 'remove', text })
  }
  return events
}

export function sanitizeLog(input: unknown): LogEvent[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((raw) => {
    const r = raw as Partial<LogEvent> | null
    if (!r || typeof r.at !== 'number' || typeof r.id !== 'string' || !KINDS.includes(r.kind as EventKind)) return []
    return [{ at: r.at, id: r.id, kind: r.kind as EventKind, ...(typeof r.text === 'string' ? { text: r.text } : {}) }]
  })
}

const eventKey = (e: LogEvent) => `${e.at}:${e.id}:${e.kind}`

/** Events from `incoming` that `existing` doesn't already have (a backup imported twice adds nothing). */
export function newEvents(existing: LogEvent[], incoming: LogEvent[]): LogEvent[] {
  const seen = new Set(existing.map(eventKey))
  return incoming.filter((e) => !seen.has(eventKey(e)))
}

// ── IndexedDB ───────────────────────────────────────────

const DB = 'daily-tracking-tool'
const STORE = 'log'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'))
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { autoIncrement: true })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

let db: Promise<IDBDatabase> | null = null
const connect = () => (db ??= open().catch((e) => ((db = null), Promise.reject(e))))

async function readAll(): Promise<LogEvent[]> {
  const d = await connect()
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE).objectStore(STORE).getAll()
    req.onsuccess = () => resolve(sanitizeLog(req.result))
    req.onerror = () => reject(req.error)
  })
}

async function append(events: LogEvent[]): Promise<void> {
  if (!events.length) return
  const d = await connect()
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const e of events) store.add(e)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Keeps the history of `tasks` as it changes. `external` marks a snapshot
 * that came from somewhere else (another tab, an import): it becomes the new
 * baseline without being logged, so the same change is never written twice.
 */
export function useEventLog(tasks: Task[], external: boolean) {
  const [log, setLog] = useState<LogEvent[]>([])
  const base = useRef(tasks)
  const pending = useRef<LogEvent[]>([])
  const ready = useRef(false)
  /** The stored history is in `log`: safe to merge into without writing an event twice. */
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    readAll()
      .then((stored) => alive && setLog((mem) => [...stored, ...mem]))
      .catch(() => {})
      .finally(() => {
        ready.current = true
        void append(pending.current).catch(() => {})
        pending.current = []
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const prev = base.current
    if (prev === tasks) return
    // Lightly debounced like the autosave, so a burst of typing is one comparison.
    const timer = setTimeout(() => {
      base.current = tasks
      if (external) return
      const events = diffEvents(prev, tasks, Date.now())
      if (!events.length) return
      setLog((l) => [...l, ...events])
      if (ready.current) void append(events).catch(() => {})
      else pending.current.push(...events)
    }, 150)
    return () => clearTimeout(timer)
  }, [tasks, external])

  /** Adds a backup's history, skipping what's already here. */
  const latest = useRef(log)
  useEffect(() => {
    latest.current = log
  }, [log])
  const merge = useCallback((incoming: LogEvent[]) => {
    const fresh = newEvents(latest.current, incoming)
    if (!fresh.length) return
    latest.current = [...latest.current, ...fresh]
    setLog(latest.current)
    void append(fresh).catch(() => {})
  }, [])

  return { log, merge, loaded }
}
