import { useCallback, useEffect, useRef, useState } from 'react'
import type { Task } from '../lib/types'
import { probeAi } from './config'
import { applyOps, idsFor, snapshot, type Change, type Op } from './ops'

export type AiJob =
  /** `changes`/`text` fill in while the answer streams, so the preview grows line by line. */
  | { phase: 'thinking'; request: string; changes?: Change[]; text?: string }
  | { phase: 'proposal'; request: string; summary: string; changes: Change[]; next: Task[]; base: Task[] }
  | { phase: 'text'; request: string; text: string }
  | { phase: 'error'; request: string; message: string }

const message = (error: unknown) => (error instanceof Error ? error.message : 'La IA falló')

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
  const [available, setAvailable] = useState(false)
  const [job, setJob] = useState<AiJob | null>(null)
  const controller = useRef<AbortController | null>(null)
  const latest = useRef({ tasks, today })
  useEffect(() => {
    latest.current = { tasks, today }
  }, [tasks, today])

  useEffect(() => {
    let live = true
    void probeAi().then((ok) => live && setAvailable(ok))
    return () => {
      live = false
    }
  }, [])

  const begin = () => {
    controller.current?.abort()
    const ctrl = new AbortController()
    controller.current = ctrl
    return ctrl
  }

  /** Changes to the sheet: capture, commands, /split, /plan. */
  const ask = useCallback(async (request: string, selectedId: string | null = null) => {
    const ctrl = begin()
    const base = latest.current.tasks
    const snap = snapshot(base, latest.current.today, selectedId)
    setJob({ phase: 'thinking', request })
    try {
      const { ask: run } = await import('./client')
      const proposal = await run({
        tool: 'propose_changes',
        request,
        context: snap.text,
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
      if (!ctrl.signal.aborted) setJob({ phase: 'error', request, message: message(error) })
    }
  }, [])

  /** Prose for the user (the day's summary). `extra` adds context the sheet alone doesn't say. */
  const write = useCallback(async (request: string, extra = '') => {
    const ctrl = begin()
    const snap = snapshot(latest.current.tasks, latest.current.today)
    setJob({ phase: 'thinking', request })
    try {
      const { ask: run } = await import('./client')
      const { text } = await run({
        tool: 'write_text',
        request,
        context: extra ? `${snap.text}\n\n${extra}` : snap.text,
        signal: ctrl.signal,
        onPartial: (partial) => partial.text && setJob({ phase: 'thinking', request, text: partial.text }),
      })
      if (!ctrl.signal.aborted) setJob({ phase: 'text', request, text })
    } catch (error) {
      if (!ctrl.signal.aborted) setJob({ phase: 'error', request, message: message(error) })
    }
  }, [])

  /** Search by meaning: the ids of the tasks that answer `query`, best first. Runs outside `job`. */
  const search = useCallback(async (query: string, signal?: AbortSignal): Promise<string[]> => {
    const snap = snapshot(latest.current.tasks, latest.current.today)
    const { ask: run } = await import('./client')
    const { ids } = await run({ tool: 'select_tasks', request: `Busca: ${query}`, context: snap.text, signal })
    return idsFor(snap.refs, ids)
  }, [])

  const cancel = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    setJob(null)
  }, [])

  return { available, job, ask, write, search, cancel }
}
