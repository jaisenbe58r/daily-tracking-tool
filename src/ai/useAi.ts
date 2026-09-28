import { useCallback, useEffect, useRef, useState } from 'react'
import type { Task } from '../lib/types'
import { probeAi } from './config'
import { applyOps, snapshot, type Change } from './ops'

export type AiJob =
  | { phase: 'thinking'; request: string }
  | { phase: 'proposal'; request: string; summary: string; changes: Change[]; next: Task[]; base: Task[] }
  | { phase: 'error'; request: string; message: string }

/**
 * One request at a time: ask, then hold the proposal until the user applies
 * or drops it. `next` is the whole sheet with the proposal applied, so
 * applying is a single undoable step; `base` is the sheet it was built on.
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

  const ask = useCallback(async (request: string, selectedId: string | null = null) => {
    controller.current?.abort()
    const ctrl = new AbortController()
    controller.current = ctrl
    const snap = snapshot(latest.current.tasks, latest.current.today, selectedId)
    setJob({ phase: 'thinking', request })
    try {
      const { ask: run } = await import('./client')
      const proposal = await run({ request, context: snap.text, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      const base = latest.current.tasks
      const { tasks: next, changes } = applyOps(base, proposal.ops, snap.refs)
      setJob({ phase: 'proposal', request, summary: proposal.summary, changes, next, base })
    } catch (error) {
      if (ctrl.signal.aborted) return
      setJob({ phase: 'error', request, message: error instanceof Error ? error.message : 'La IA falló' })
    }
  }, [])

  const cancel = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    setJob(null)
  }, [])

  return { available, job, ask, cancel }
}
