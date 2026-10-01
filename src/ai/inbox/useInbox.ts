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

export type Taken = { found: Found } | { none: true; problem?: string }

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

  /**
   * One look at every source: mail, calendar and notes through Claude, GitHub
   * as it is. Read and nothing to do: marked seen, so it isn't read again.
   * `skip` returns undefined when the sources hold just what's already waiting.
   */
  const look = useCallback(async (skip: boolean): Promise<{ found: Found | null; problem?: string } | null | undefined> => {
    const { tasks, today } = latest.current
    const [{ gather }, { githubFound }] = await Promise.all([import('./connectors'), import('../../github/inbox')])
    const [gathered, gh] = await Promise.all([
      gather(isSeen, watchedTasks(tasks), knownNotes(tasks)),
      githubFound(tasks, today, isSeen).catch(() => ({ found: null as Found | null, problem: undefined })),
    ])
    checkedAt.current = Date.now()
    if (!gathered) return null
    const { candidates, problems } = gathered
    const problem = problems[0] ?? gh.problem
    // Same threads and items as the proposal already waiting: nothing new to ask Claude about.
    const keys = new Set([...candidates.map((c) => `${c.id}@${c.version}`), ...(gh.found?.keys ?? [])])
    const waiting = latest.current.found
    if (skip && keys.size && waiting && waiting.keys.length === keys.size && waiting.keys.every((k) => keys.has(k))) return undefined
    let mail: Found | null = null
    if (candidates.length) {
      const { extract } = await import('./extract')
      mail = await extract('claude', tasks, today, candidates)
    }
    const found = merge(mail, gh.found)
    if (found && !found.count) {
      markSeen(found.keys)
      return { found: null, problem }
    }
    return { found, problem }
  }, [])

  const check = useCallback((): Promise<void> => {
    if (running.current) return running.current
    const run = (async () => {
      const looked = await look(true)
      if (!looked) return
      setProblem(looked.problem ?? null)
      setFound(looked.found)
    })()
      .catch(() => {
        /* a quiet background check: the next one tries again, and «Recoger» says what failed */
      })
      .finally(() => {
        running.current = null
      })
    running.current = run
    return run
  }, [setFound, look])

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
      const looked = await look(false)
      if (looked === null) return { none: true, problem: 'Esta página no puede leer tu correo aquí' }
      setProblem(looked?.problem ?? null)
      if (!looked?.found) return { none: true, problem: looked?.problem }
      setFound(looked.found)
    }
    const waiting = latest.current.found
    return waiting ? { found: waiting } : { none: true, problem: problem ?? undefined }
  }, [problem, setFound, look])

  /** The user has seen these (accepted or not): they won't be proposed again. */
  const clear = useCallback(
    (done: Found) => {
      markSeen(done.keys)
      if (latest.current.found === done) setFound(null)
    },
    [setFound],
  )

  const meetings = found?.ops.filter((op) => op.op === 'add' && op.source?.app === 'granola').length ?? 0
  const github = found?.github ?? 0
  return { available, count: found?.count ?? 0, replies: found?.replies ?? 0, meetings, github, take, clear }
}

/** Mail, calendar and notes (read by Claude) and GitHub (read as is) in one proposal. Both use the same sheet refs. */
export function merge(mail: Found | null, gh: Found | null): Found | null {
  if (!mail || !gh) return mail ?? gh
  const summary = [mail.count ? mail.summary : '', gh.count ? gh.summary : ''].filter(Boolean).join(' · ')
  return {
    summary,
    ops: [...mail.ops, ...gh.ops],
    refs: mail.refs,
    keys: [...mail.keys, ...gh.keys],
    count: mail.count + gh.count,
    replies: mail.replies,
    dropped: mail.dropped,
    github: gh.github,
  }
}
