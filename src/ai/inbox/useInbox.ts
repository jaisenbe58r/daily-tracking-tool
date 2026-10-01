import { useCallback, useEffect, useRef, useState } from 'react'
import type { Task } from '../../lib/types'
import type { AiMode } from '../config'
import { markSeen, isSeen } from './seen'
import { watchedTasks } from './sources'
import { knownNotes } from './granola'
import type { Found } from './extract'

/** How often the sources are read again while the page is in view. */
const EVERY_MS = 15 * 60_000
/** A manual «Recoger» reuses a check this fresh instead of reading everything again. */
const FRESH_MS = 2 * 60_000

export type Taken = { found: Found } | { none: true; problem?: string; scan?: string }

/**
 * «Recoger»: tasks hiding in the user's mail, calendar and meeting notes. Runs by itself when
 * the page opens and every 15 minutes while it's in view, so the header can
 * say how many tasks are waiting; nothing reaches the sheet until the user
 * opens them (Alt+I) and accepts. Only inside claude.ai, where the page can
 * read the user's connectors and ask Claude.
 */
export function useInbox(mode: AiMode | null, tasks: Task[], today: string) {
  const [available, setAvailable] = useState(false)
  const [found, setFoundState] = useState<Found | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  /** What the last check read: the proof, shown with what Recoger found (or didn't). */
  const scan = useRef('')
  const latest = useRef({ tasks, today, found: null as Found | null })
  useEffect(() => {
    latest.current.tasks = tasks
    latest.current.today = today
  }, [tasks, today])
  /** Kept in the ref at once too: `take` reads it right after awaiting a check. */
  const setFound = useCallback((f: Found | null) => {
    latest.current.found = f
    setFoundState(f)
  }, [])
  const running = useRef<Promise<void> | null>(null)
  const checkedAt = useRef(0)

  useEffect(() => {
    if (mode !== 'claude') return
    let live = true
    void import('./connectors').then(({ connectors }) => connectors()).then((m) => live && setAvailable(Boolean(m)))
    return () => {
      live = false
    }
  }, [mode])

  const check = useCallback((): Promise<void> => {
    if (running.current) return running.current
    const run = (async () => {
      const { gather } = await import('./connectors')
      const gathered = await gather(isSeen, watchedTasks(latest.current.tasks), knownNotes(latest.current.tasks))
      checkedAt.current = Date.now()
      if (!gathered) return
      const { candidates, problems } = gathered
      const { scanLine } = await import('./connectors')
      scan.current = scanLine(gathered.scanned)
      setProblem(problems[0] ?? null)
      if (!candidates.length) {
        setFound(null)
        return
      }
      // Same threads as the proposal already waiting: nothing new to ask Claude about.
      const keys = new Set(candidates.map((c) => `${c.id}@${c.version}`))
      const waiting = latest.current.found
      if (waiting && waiting.keys.length === keys.size && waiting.keys.every((k) => keys.has(k))) return
      const { extract } = await import('./extract')
      const next = await extract('claude', latest.current.tasks, latest.current.today, candidates)
      if (next.count) setFound({ ...next, scan: scan.current })
      else {
        // Read and nothing to do: don't read these again.
        markSeen(next.keys)
        setFound(null)
      }
    })()
      .catch(() => {
        /* a quiet background check: the next one tries again, and «Recoger» says what failed */
      })
      .finally(() => {
        running.current = null
      })
    running.current = run
    return run
  }, [setFound])

  // In the background: soon after opening, then every 15 minutes while the page is in view.
  useEffect(() => {
    if (!available) return
    const due = () => !document.hidden && Date.now() - checkedAt.current >= EVERY_MS
    const first = setTimeout(() => void check(), 1500)
    const timer = setInterval(() => due() && void check(), 60_000)
    const onVisible = () => due() && void check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [available, check])

  /** The tasks found so far, reading again if the last look is old. Stays waiting until `clear`. */
  const take = useCallback(async (): Promise<Taken> => {
    if (running.current) await running.current
    else if (!latest.current.found && Date.now() - checkedAt.current > FRESH_MS) {
      const { gather } = await import('./connectors')
      const gathered = await gather(isSeen, watchedTasks(latest.current.tasks), knownNotes(latest.current.tasks))
      checkedAt.current = Date.now()
      if (!gathered) return { none: true, problem: 'Esta página no puede leer tu correo aquí' }
      const { scanLine } = await import('./connectors')
      scan.current = scanLine(gathered.scanned)
      setProblem(gathered.problems[0] ?? null)
      if (!gathered.candidates.length) return { none: true, problem: gathered.problems[0], scan: scan.current }
      const { extract } = await import('./extract')
      const next = await extract('claude', latest.current.tasks, latest.current.today, gathered.candidates)
      if (next.count) setFound({ ...next, scan: scan.current })
      else markSeen(next.keys)
    }
    const waiting = latest.current.found
    return waiting ? { found: waiting } : { none: true, problem: problem ?? undefined, scan: scan.current }
  }, [problem, setFound])

  /** The user has seen these (accepted or not): they won't be proposed again. */
  const clear = useCallback(
    (done: Found) => {
      markSeen(done.keys)
      if (latest.current.found === done) setFound(null)
    },
    [setFound],
  )

  const meetings = found?.ops.filter((op) => op.op === 'add' && op.source?.app === 'granola').length ?? 0
  return { available, count: found?.count ?? 0, replies: found?.replies ?? 0, meetings, take, clear }
}
