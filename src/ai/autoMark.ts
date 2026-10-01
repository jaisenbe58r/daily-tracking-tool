import { useEffect, useRef } from 'react'
import type { Action } from '../lib/store'
import type { Task } from '../lib/types'
import { hasMark } from '../lib/mark'
import type { AiMode } from './config'

/**
 * Subrayado automático: a moment after a task is written, captured (Ctrl+K)
 * or brought in by Recoger, the AI picks its key phrase, if it has one, and
 * puts the green block behind it. Sparingly: one short phrase at most, and
 * often none. Alt+U and ==…== still work, and a highlight the user removes
 * stays removed (each task is looked at once). What was already on the sheet
 * gets one stricter pass on opening: about one task in four at most.
 */

/** Only tasks written in the last few minutes: what was already on the sheet stays as it is. */
const FRESH = 15 * 60_000
/** Pause after the last change, so a task is looked at once it's written, not while. */
const IDLE = 2500
/** Tasks per request. */
const BATCH = 12
const MAX_WORDS = 5

export function candidates(tasks: Task[], now: number, editing: string | null): Task[] {
  return tasks
    .filter(
      (t) =>
        !t.autoMarked &&
        t.id !== editing &&
        t.status !== 'done' &&
        now - t.createdAt < FRESH &&
        t.text.trim().split(/\s+/).length >= 3 &&
        !hasMark(t.text),
    )
    .slice(0, BATCH)
}

/**
 * The text with `phrase` highlighted, or null when the phrase doesn't fit:
 * not in the text word for word, too long, most of the task, or crossing a
 * #tag or a marker.
 */
export function markPhrase(text: string, phrase: string): string | null {
  const p = phrase.trim().replace(/^[«"']+|[»"']+$/g, '').trim()
  if (!p || p.includes('==') || /(^|\s)#/.test(p)) return null
  if (p.split(/\s+/).length > MAX_WORDS || p.length > text.trim().length * 0.7) return null
  const at = text.indexOf(p)
  if (at < 0) return null
  // Whole words only: "demo" inside "demostración" is not a phrase.
  const before = text[at - 1]
  const after = text[at + p.length]
  if ((before && /[\p{L}\p{N}]/u.test(before)) || (after && /[\p{L}\p{N}]/u.test(after))) return null
  return `${text.slice(0, at)}==${p}==${text.slice(at + p.length)}`
}

const FRESH_REQUEST = 'Elige la frase clave a subrayar en estas tareas, solo en las que lo merezcan.'
const BACKLOG_REQUEST =
  'Estas tareas ya estaban en el folio. Sé exigente: subraya solo donde el dato clave se perdería al leer rápido (un plazo, una cifra, un nombre propio, el entregable). Como mucho una de cada cuatro; el resto, ninguna.'
/** Backlog: at most one task in four gets a highlight, whatever the model says. */
const BACKLOG_SHARE = 0.25
/** Backlog tasks looked at per visit (the rest wait for the next one), and per request. */
const BACKLOG_LIMIT = 80
const BACKLOG_BATCH = 20

/** What was already on the sheet: open, unflagged tasks that aren't fresh (those go the usual way). */
export function backlog(tasks: Task[], now: number, editing: string | null): Task[] {
  return tasks
    .filter(
      (t) =>
        !t.autoMarked &&
        t.id !== editing &&
        t.status !== 'done' &&
        now - t.createdAt >= FRESH &&
        t.text.trim().split(/\s+/).length >= 3 &&
        !hasMark(t.text),
    )
    .slice(0, BACKLOG_LIMIT)
}

type Ask = typeof import('./client').ask

/** One request: the tasks' new texts (only the highlighted ones), at most `cap` of them. */
async function lookAt(ask: Ask, mode: AiMode, batch: Task[], request: string, cap = batch.length) {
  const refs = batch.map((t, i) => [`t${i + 1}`, t] as const)
  const { marks } = await ask(mode, {
    tool: 'mark_phrases',
    request,
    context: refs.map(([ref, t]) => `${ref} | ${t.text.trim()}`).join('\n'),
  })
  const byRef = new Map<string, Task>(refs)
  const texts: Record<string, string> = {}
  for (const { id, phrase } of marks) {
    if (Object.keys(texts).length >= cap) break
    const task = byRef.get(id)
    if (!task || texts[task.id]) continue
    const next = markPhrase(task.text, phrase)
    if (next) texts[task.id] = next
  }
  return texts
}

export function useAutoMark(mode: AiMode | null, hasKey: boolean, tasks: Task[], dispatch: (action: Action) => void) {
  /** Looked at in this visit, even if an undo brings the flag back. */
  const tried = useRef(new Set<string>())
  const busy = useRef(false)
  /** The pass over what was already on the sheet: once per visit. */
  const backlogDone = useRef(false)
  /** Claude said no (permission, quota): no more tries until the page opens again. */
  const off = useRef(false)
  const latest = useRef(tasks)
  useEffect(() => {
    latest.current = tasks
  }, [tasks])

  const ready = mode !== null && (mode !== 'key' || hasKey)

  useEffect(() => {
    if (!ready || off.current) return
    const timer = setTimeout(async () => {
      if (busy.current || off.current || !mode) return
      const editing = (document.activeElement as HTMLElement | null)?.dataset?.taskText ?? null
      const now = Date.now()
      const fresh = candidates(latest.current, now, editing).filter((t) => !tried.current.has(t.id))
      const old = fresh.length || backlogDone.current ? [] : backlog(latest.current, now, editing).filter((t) => !tried.current.has(t.id))
      const batch = fresh.length ? fresh : old
      if (!batch.length) return
      busy.current = true
      if (!fresh.length) backlogDone.current = true
      batch.forEach((t) => tried.current.add(t.id))
      try {
        const { ask } = await import('./client')
        const texts: Record<string, string> = {}
        if (fresh.length) Object.assign(texts, await lookAt(ask, mode, fresh, FRESH_REQUEST))
        else
          for (let i = 0; i < old.length; i += BACKLOG_BATCH) {
            const part = old.slice(i, i + BACKLOG_BATCH)
            Object.assign(texts, await lookAt(ask, mode, part, BACKLOG_REQUEST, Math.max(1, Math.round(part.length * BACKLOG_SHARE))))
          }
        // Rewritten while the AI was thinking: left as is, and looked at again later.
        const current = new Map(latest.current.map((t) => [t.id, t.text]))
        const seen = batch.filter((t) => current.get(t.id) === t.text).map((t) => t.id)
        const kept = Object.fromEntries(Object.entries(texts).filter(([id]) => seen.includes(id)))
        // One action for the whole pass: one Ctrl+Z takes it all back.
        if (seen.length) dispatch({ type: 'auto-mark', seen, texts: kept })
      } catch (error) {
        const msg = error instanceof Error ? error.message : ''
        if (error instanceof Error && error.name === 'NeedsKey') off.current = true
        else if (/permiso|agotado|no está disponible/.test(msg)) off.current = true
      } finally {
        busy.current = false
      }
    }, IDLE)
    return () => clearTimeout(timer)
  }, [ready, mode, tasks, dispatch])
}
