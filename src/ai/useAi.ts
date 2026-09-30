import { useCallback, useEffect, useRef, useState } from 'react'
import type { Task } from '../lib/types'
import { apiKey, probeAi, type AiMode } from './config'
import { applyOps, idsFor, snapshot, type Change, type Op } from './ops'

export type AiJob =
  /** `changes`/`text` fill in while the answer streams, so the preview grows line by line. */
  | { phase: 'thinking'; request: string; changes?: Change[]; text?: string }
  | { phase: 'proposal'; request: string; summary: string; changes: Change[]; next: Task[]; base: Task[] }
  | { phase: 'text'; request: string; text: string }
  | { phase: 'error'; request: string; message: string }
  /** Key mode with no key (or a refused one): the panel asks for it, then the request goes out. */
  | { phase: 'key'; request: string; invalid: boolean }

const message = (error: unknown) => (error instanceof Error ? error.message : 'La IA falló')
const needsKey = (error: unknown): error is Error & { invalid: boolean } => error instanceof Error && error.name === 'NeedsKey'

/** Only ops the model has finished enough to mean something. */
const settled = (ops: Partial<Op>[] | undefined): Op[] =>
  (ops ?? []).filter((op): op is Op => Boolean(op?.op && (op.op === 'add' ? op.text : op.id)))

/**
 * One request at a time: ask, then hold the answer until the user applies
 * (or copies) it or drops it. For changes, `next` is the whole sheet with the
 * proposal applied, so applying is a single undoable step; `base` is the
 * sheet it was built on.
 */
export function useAi(tasks: Task[], today: string) {
  const [mode, setMode] = useState<AiMode | null>(null)
  const [hasKey, setHasKey] = useState(() => Boolean(apiKey.get()))
  const [job, setJob] = useState<AiJob | null>(null)
  const controller = useRef<AbortController | null>(null)
  /** The request waiting on a key, sent again once the user gives one. */
  const pending = useRef<(() => void) | null>(null)
  const modeRef = useRef<AiMode>('server')
  const latest = useRef({ tasks, today })
  useEffect(() => {
    latest.current = { tasks, today }
  }, [tasks, today])

  useEffect(() => {
    let live = true
    void probeAi().then((found) => {
      if (!live) return
      if (found) modeRef.current = found
      setMode(found)
    })
    return () => {
      live = false
    }
  }, [])

  const failed = (request: string, error: unknown, retry: () => void) => {
    if (needsKey(error)) {
      pending.current = retry
      setHasKey(false)
      setJob({ phase: 'key', request, invalid: error.invalid })
    } else setJob({ phase: 'error', request, message: message(error) })
  }

  const begin = () => {
    controller.current?.abort()
    const ctrl = new AbortController()
    controller.current = ctrl
    return ctrl
  }

  /** Changes to the sheet: capture, commands, /split, /plan. `extra` adds context the sheet alone doesn't say. */
  const ask = useCallback(async function ask(request: string, selectedId: string | null = null, extra = '') {
    const ctrl = begin()
    const base = latest.current.tasks
    const snap = snapshot(base, latest.current.today, selectedId)
    setJob({ phase: 'thinking', request })
    try {
      const { ask: run } = await import('./client')
      const proposal = await run(modeRef.current, {
        tool: 'propose_changes',
        request,
        context: extra ? `${snap.text}\n\n${extra}` : snap.text,
        signal: ctrl.signal,
        onPartial: (partial) => {
          const changes = applyOps(base, settled(partial.ops), snap.refs, latest.current.today).changes
          if (changes.length) setJob({ phase: 'thinking', request, changes })
        },
      })
      if (ctrl.signal.aborted) return
      const { tasks: next, changes } = applyOps(base, proposal.ops, snap.refs, latest.current.today)
      setJob({ phase: 'proposal', request, summary: proposal.summary, changes, next, base })
    } catch (error) {
      if (!ctrl.signal.aborted) failed(request, error, () => void ask(request, selectedId, extra))
    }
  }, [])

  /**
   * Prose for the user (the day's summary, a draft). `extra` adds context the sheet alone doesn't say;
   * `onText` gets the finished text (drafts are kept for next time).
   */
  const write = useCallback(async function write(request: string, extra = '', selectedId: string | null = null, onText?: (text: string) => void) {
    const ctrl = begin()
    const snap = snapshot(latest.current.tasks, latest.current.today, selectedId)
    setJob({ phase: 'thinking', request })
    try {
      const { ask: run } = await import('./client')
      const { text } = await run(modeRef.current, {
        tool: 'write_text',
        request,
        context: extra ? `${snap.text}\n\n${extra}` : snap.text,
        signal: ctrl.signal,
        onPartial: (partial) => partial.text && setJob({ phase: 'thinking', request, text: partial.text }),
      })
      if (ctrl.signal.aborted) return
      onText?.(text)
      setJob({ phase: 'text', request, text })
    } catch (error) {
      if (!ctrl.signal.aborted) failed(request, error, () => void write(request, extra, selectedId, onText))
    }
  }, [])

  /** Search by meaning: the ids of the tasks that answer `query`, best first. Runs outside `job`. */
  const search = useCallback(async (query: string, signal?: AbortSignal): Promise<string[]> => {
    const snap = snapshot(latest.current.tasks, latest.current.today)
    const { ask: run } = await import('./client')
    const { ids } = await run(modeRef.current, { tool: 'select_tasks', request: `Busca: ${query}`, context: snap.text, signal })
    return idsFor(snap.refs, ids)
  }, [])

  /**
   * A proposal worked out elsewhere (Recoger, in the background), shown like any
   * other: applied on top of the sheet as it is now. `refs` are the sheet's refs
   * when the model read it, so parents still resolve if rows moved since.
   * Without `found`, just the waiting state while it's being worked out.
   */
  const present = useCallback((request: string, found?: { summary: string; ops: Op[]; refs: Map<string, string> }) => {
    controller.current?.abort()
    controller.current = null
    if (!found) {
      setJob({ phase: 'thinking', request })
      return
    }
    const base = latest.current.tasks
    const { tasks: next, changes } = applyOps(base, found.ops, found.refs, latest.current.today)
    setJob({ phase: 'proposal', request, summary: found.summary, changes, next, base })
  }, [])

  /** Text worked out earlier (a kept draft), shown like a fresh answer. */
  const showText = useCallback((request: string, text: string) => {
    controller.current?.abort()
    controller.current = null
    setJob({ phase: 'text', request, text })
  }, [])

  const fail = useCallback((request: string, error: unknown) => setJob({ phase: 'error', request, message: message(error) }), [])

  const cancel = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    pending.current = null
    setJob(null)
  }, [])

  /** Keeps the key in this browser and sends the request that was waiting for it. */
  const saveKey = useCallback((key: string) => {
    apiKey.set(key)
    setHasKey(true)
    const retry = pending.current
    pending.current = null
    if (retry) retry()
    else setJob(null)
  }, [])

  const forgetKey = useCallback(() => {
    apiKey.clear()
    setHasKey(false)
  }, [])

  return { available: mode !== null, mode, hasKey, job, ask, write, search, present, showText, fail, cancel, saveKey, forgetKey }
}
