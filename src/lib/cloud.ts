import { useEffect, useRef, useState } from 'react'
import { claudeHost } from '../ai/config'
import { sanitize } from './persist'
import { sanitizeTemplates, type Template } from './templates'
import type { Task } from './types'
import { sanitizeLog, type LogEvent } from '../memory/log'
import { dateKey } from './parse'

/**
 * Inside claude.ai each artifact link is its own site, so the browser keeps a
 * separate sheet per link and per device. When the page runs there, the sheet
 * also lives in the artifact's own store, under the viewer's private subtree:
 * the same tasks on every device, kept across republishes. Everywhere else
 * (dev server, a copy hosted elsewhere) this does nothing and localStorage
 * stays the only home.
 *
 * The sheet is written as a few documents (`folio-0`, `folio-1`, ...) because
 * one document holds at most 256 KiB; all parts of one save share `savedAt`.
 */

export interface Sheet {
  tasks: Task[]
  templates: Template[]
}

/** What this device last agreed on with the store: a save's stamp and the hash of its content. */
export interface Base {
  savedAt: number
  hash: string
}

interface Part {
  savedAt: number
  count: number
  part: string
}

const PREFIX = 'folio-'
/** Characters per part: even all three-byte characters plus escaping stay well under 256 KiB. */
const CHUNK = 60_000
const BASE_KEY = 'daily-tracking-tool:nube'
/** Pause after the last change before writing, so typing is one write. */
const DELAY = 1200

/** One stable string per sheet, so two devices with the same tasks agree. */
export function serialize(sheet: Sheet): string {
  return JSON.stringify({ tasks: sanitize(sheet.tasks), templates: sanitizeTemplates(sheet.templates) })
}

export function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return `${(h >>> 0).toString(36)}:${text.length}`
}

export function split(text: string, savedAt: number, size = CHUNK): Part[] {
  const count = Math.max(1, Math.ceil(text.length / size))
  return Array.from({ length: count }, (_, i) => ({ savedAt, count, part: text.slice(i * size, (i + 1) * size) }))
}

/** The last complete save among `docs`, or null while there is none (empty store, or a save still landing). */
export function join(docs: Map<string, unknown>): { savedAt: number; text: string } | null {
  const first = docs.get(`${PREFIX}0`) as Partial<Part> | undefined
  if (!first || typeof first.savedAt !== 'number' || typeof first.count !== 'number') return null
  let text = ''
  for (let i = 0; i < first.count; i++) {
    const p = docs.get(`${PREFIX}${i}`) as Partial<Part> | undefined
    if (!p || p.savedAt !== first.savedAt || typeof p.part !== 'string') return null
    text += p.part
  }
  return { savedAt: first.savedAt, text }
}

export function readSheet(text: string): Sheet | null {
  try {
    const json = JSON.parse(text)
    return { tasks: sanitize(json?.tasks), templates: sanitizeTemplates(json?.templates) }
  } catch {
    return null
  }
}

const hasWords = (sheet: Sheet) => sheet.tasks.some((t) => t.text.trim()) || sheet.templates.length > 0

/**
 * Edits on both sides since they last agreed: keep everything. The store's
 * version wins for a task both changed; tasks only this device has are kept.
 */
export function merge(remote: Sheet, local: Sheet): Sheet {
  const ids = new Set(remote.tasks.map((t) => t.id))
  const names = new Set(remote.templates.map((t) => t.name))
  return {
    tasks: [...remote.tasks, ...local.tasks.filter((t) => !ids.has(t.id) && t.text.trim())],
    templates: [...remote.templates, ...local.templates.filter((t) => !names.has(t.name))],
  }
}

export type Plan =
  /** Nothing to do. */
  | { kind: 'keep' }
  /** This device has what the store lacks: write it. */
  | { kind: 'push' }
  /** Take the store's sheet as is. */
  | { kind: 'take'; sheet: Sheet }
  /** Both changed: take the union and write it back. */
  | { kind: 'merge'; sheet: Sheet }

/**
 * What to do when the store shows `remote` (null: empty store) and this device
 * holds `local`, having last agreed on `base` (null: never synced here).
 */
export function plan(remote: { savedAt: number; sheet: Sheet } | null, local: Sheet, base: Base | null): Plan {
  const mine = hash(serialize(local))
  if (!remote) return hasWords(local) ? { kind: 'push' } : { kind: 'keep' }
  const theirs = hash(serialize(remote.sheet))
  if (theirs === mine) return { kind: 'keep' }
  // The store hasn't moved since we last agreed: only this device changed.
  if (base && remote.savedAt === base.savedAt) return { kind: 'push' }
  const dirty = base ? base.hash !== mine : hasWords(local)
  if (!dirty) return { kind: 'take', sheet: remote.sheet }
  return { kind: 'merge', sheet: merge(remote.sheet, local) }
}

function readBase(): Base | null {
  try {
    const b = JSON.parse(localStorage.getItem(BASE_KEY) ?? 'null') as Partial<Base> | null
    return b && typeof b.savedAt === 'number' && typeof b.hash === 'string' ? { savedAt: b.savedAt, hash: b.hash } : null
  } catch {
    return null
  }
}

function writeBase(base: Base) {
  try {
    localStorage.setItem(BASE_KEY, JSON.stringify(base))
  } catch {
    // Storage blocked: the next visit compares contents instead.
  }
}

// ── claude.ai store ─────────────────────────────────────

interface Snap {
  id: string
  exists: boolean
  data(): Record<string, unknown> | undefined
}
interface DocRef {
  set(data: Record<string, unknown>): Promise<void>
  delete(): Promise<void>
}
interface Collection {
  doc(id: string): DocRef
  onSnapshot(next: (s: { docs: Snap[]; metadata: { fromCache: boolean } }) => void, error?: (e: { code?: string }) => void): () => void
}
interface Db {
  collection(path: string): Collection
}
interface User {
  id(): Promise<string | null>
}

/** The viewer's private collection at `data/users/<id>` + `sub`, or null outside claude.ai. */
async function openStore(sub = ''): Promise<Collection | null> {
  const host = claudeHost()
  if (!host) return null
  const [db, user] = await Promise.all([host.use('db').catch(() => null), host.use('user').catch(() => null)])
  if (!db || !user) return null
  const id = await (user as User).id().catch(() => null)
  return id ? (db as Db).collection(`data/users/${id}${sub}`) : null
}

interface Options {
  tasks: Task[]
  templates: Template[]
  /** Swap in the sheet from the store (another device, or the first sync). */
  replace: (sheet: Sheet) => void
  notify: (text: string) => void
}

/** Keeps the sheet and templates in the artifact's store, both ways. */
export function useCloudSync({ tasks, templates, replace, notify }: Options) {
  const latest = useRef<Sheet>({ tasks, templates })
  const actions = useRef({ replace, notify })
  useEffect(() => {
    latest.current = { tasks, templates }
    actions.current = { replace, notify }
  })
  /** Writes the sheet if it changed; a no-op until the first sync, and outside claude.ai. */
  const save = useRef(() => {})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let stop = () => {}
    let alive = true
    let store: Collection | null = null
    let base = readBase()
    let synced = false
    /** Parts the store holds, so a shorter save can drop the rest. */
    let written = 0
    /** The stamp of the save being written, so its own echo isn't taken for someone else's. */
    let pending: number | null = null
    let busy = false
    let again = false

    const write = async () => {
      if (!store || !synced) return
      if (busy) {
        again = true
        return
      }
      const text = serialize(latest.current)
      const h = hash(text)
      if (base?.hash === h) return
      busy = true
      const savedAt = Date.now()
      pending = savedAt
      try {
        const parts = split(text, savedAt)
        // One write at a time; a reader takes a save only once every part carries its stamp.
        for (let i = 0; i < parts.length; i++) await store.doc(`${PREFIX}${i}`).set({ ...parts[i] })
        for (let i = parts.length; i < written; i++) await store.doc(`${PREFIX}${i}`).delete()
        written = parts.length
        base = { savedAt, hash: h }
        writeBase(base)
      } catch (e) {
        const code = (e as { code?: string })?.code
        if (code === 'quota_exceeded') actions.current.notify('La nube de claude.ai está llena: la hoja sigue guardada en este navegador')
        else if (code === 'unavailable') again = true
      } finally {
        busy = false
        if (again && alive) {
          again = false
          setTimeout(() => void write(), DELAY)
        }
      }
    }
    save.current = () => void write()

    void openStore().then((found) => {
      if (!found || !alive) return
      store = found
      stop = found.onSnapshot(
        (snap) => {
          if (snap.metadata.fromCache) return
          const docs = new Map(snap.docs.filter((d) => d.exists && d.id.startsWith(PREFIX)).map((d) => [d.id, d.data()]))
          written = Math.max(written, docs.size)
          const saved = join(docs)
          // A save still landing part by part, our own save coming back, or one we already hold.
          if (synced && (!saved || saved.savedAt === pending || saved.savedAt === base?.savedAt)) return
          const sheet = saved && readSheet(saved.text)
          const next = plan(saved && sheet ? { savedAt: saved.savedAt, sheet } : null, latest.current, base)
          if (next.kind === 'take' || next.kind === 'merge') {
            latest.current = next.sheet
            actions.current.replace(next.sheet)
          }
          if (saved && next.kind !== 'push') {
            base = { savedAt: saved.savedAt, hash: hash(saved.text) }
            writeBase(base)
          }
          if (next.kind === 'merge' && synced) actions.current.notify('Se han unido cambios hechos en otro dispositivo')
          synced = true
          setReady(true)
          if (next.kind === 'push' || next.kind === 'merge') void write()
        },
        () => {
          // Revoked or refused: carry on with this browser's copy only.
          store = null
        },
      )
    })

    const flush = () => void write()
    window.addEventListener('pagehide', flush)
    return () => {
      alive = false
      stop()
      save.current = () => {}
      window.removeEventListener('pagehide', flush)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => save.current(), DELAY)
    return () => clearTimeout(timer)
  }, [ready, tasks, templates])
}

// ── Memoria history ─────────────────────────────────────

/**
 * The history behind the Memoria only ever grows, so it travels as one
 * document per week (`data/users/<id>/memoria/weeks/<monday>`) holding that
 * week's events. Each side adds what the other lacks; nothing is ever removed.
 */
const WEEKS = '/memoria/weeks'

const eventKey = (e: LogEvent) => `${e.at}:${e.id}:${e.kind}`

/** The Monday that starts the week of `at`, as YYYY-MM-DD. */
export function weekOf(at: number): string {
  const d = new Date(at)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return dateKey(d)
}

/** For each week where `local` has events `remote` lacks, the week's events as they should be stored. */
export function weeksToWrite(local: LogEvent[], remote: Map<string, LogEvent[]>): Map<string, LogEvent[]> {
  const out = new Map<string, LogEvent[]>()
  const known = new Map<string, Set<string>>()
  for (const e of local) {
    const week = weekOf(e.at)
    let seen = known.get(week)
    if (!seen) known.set(week, (seen = new Set((remote.get(week) ?? []).map(eventKey))))
    if (seen.has(eventKey(e))) continue
    seen.add(eventKey(e))
    const events = out.get(week) ?? [...(remote.get(week) ?? [])]
    events.push(e)
    out.set(week, events)
  }
  for (const events of out.values()) events.sort((a, b) => a.at - b.at)
  return out
}

interface LogOptions {
  log: LogEvent[]
  /** The stored history has been read; until then nothing is merged or written. */
  loaded: boolean
  /** Adds events from other devices, skipping the ones already here. */
  merge: (events: LogEvent[]) => void
}

/** Keeps the Memoria history in the artifact's store too, merged from every device. */
export function useCloudLog({ log, loaded, merge }: LogOptions) {
  const latest = useRef(log)
  const mergeRef = useRef(merge)
  useEffect(() => {
    latest.current = log
    mergeRef.current = merge
  })
  const save = useRef(() => {})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!loaded) return
    let stop = () => {}
    let alive = true
    let store: Collection | null = null
    /** What the store holds, week by week, as of the last snapshot or our own write. */
    const remote = new Map<string, LogEvent[]>()
    let busy = false
    let again = false

    const write = async () => {
      if (!store) return
      if (busy) {
        again = true
        return
      }
      const weeks = weeksToWrite(latest.current, remote)
      if (!weeks.size) return
      busy = true
      try {
        for (const [week, events] of weeks) {
          await store.doc(week).set({ events })
          remote.set(week, events)
        }
      } catch (e) {
        const code = (e as { code?: string })?.code
        if (code === 'unavailable') again = true
      } finally {
        busy = false
        if (again && alive) {
          again = false
          setTimeout(() => void write(), DELAY)
        }
      }
    }
    save.current = () => void write()

    void openStore(WEEKS).then((found) => {
      if (!found || !alive) return
      store = found
      stop = found.onSnapshot(
        (snap) => {
          if (snap.metadata.fromCache) return
          const incoming: LogEvent[] = []
          for (const d of snap.docs) {
            if (!d.exists) continue
            // A stale or overwritten week only means a write adds back what it lacks.
            const events = sanitizeLog(d.data()?.events)
            remote.set(d.id, events)
            incoming.push(...events)
          }
          if (incoming.length) mergeRef.current(incoming)
          setReady(true)
          void write()
        },
        () => {
          store = null
        },
      )
    })

    return () => {
      alive = false
      stop()
      save.current = () => {}
    }
  }, [loaded])

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => save.current(), DELAY)
    return () => clearTimeout(timer)
  }, [ready, log])
}
