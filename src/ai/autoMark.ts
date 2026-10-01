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
 * stays removed (each task is looked at once).
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

export function useAutoMark(mode: AiMode | null, hasKey: boolean, tasks: Task[], dispatch: (action: Action) => void) {
  /** Looked at in this visit, even if an undo brings the flag back. */
  const tried = useRef(new Set<string>())
  const busy = useRef(false)
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
      if (busy.current || off.current) return
      const editing = (document.activeElement as HTMLElement | null)?.dataset?.taskText ?? null
      const batch = candidates(latest.current, Date.now(), editing).filter((t) => !tried.current.has(t.id))
      if (!batch.length) return
      busy.current = true
      batch.forEach((t) => tried.current.add(t.id))
      try {
        const { ask } = await import('./client')
        const refs = batch.map((t, i) => [`t${i + 1}`, t] as const)
        const { marks } = await ask(mode!, {
          tool: 'mark_phrases',
          request: 'Elige la frase clave a subrayar en estas tareas, solo en las que lo merezcan.',
          context: refs.map(([ref, t]) => `${ref} | ${t.text.trim()}`).join('\n'),
        })
        const byRef = new Map<string, Task>(refs)
        const sent = new Map(batch.map((t) => [t.id, t.text]))
        const now = new Map(latest.current.map((t) => [t.id, t]))
        const texts: Record<string, string> = {}
        for (const { id, phrase } of marks) {
          const task = byRef.get(id)
          const current = task && now.get(task.id)
          // Rewritten while the AI was thinking: leave it.
          if (!current || current.text !== sent.get(current.id) || texts[current.id]) continue
          const next = markPhrase(current.text, phrase)
          if (next) texts[current.id] = next
        }
        // Only tasks still as they were sent count as looked at.
        const seen = batch.filter((t) => now.get(t.id)?.text === t.text).map((t) => t.id)
        if (seen.length) dispatch({ type: 'auto-mark', seen, texts })
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
