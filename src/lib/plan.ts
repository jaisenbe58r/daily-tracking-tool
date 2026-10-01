import { useCallback, useEffect, useState } from 'react'
import type { Task } from './types'

/** Plan del día: a few tasks, in the order to do them. Kept only for the day it was made. */
export interface DayPlan {
  /** Local date (YYYY-MM-DD) the plan is for; any other day it's gone. */
  date: string
  /** Task ids, most important first. */
  ids: string[]
  /** The AI's one-line reason per task, when it gave one. */
  why?: Record<string, string>
}

export type StepState = 'done' | 'now' | 'next'

export interface PlanStep {
  task: Task
  /** The top-level task it belongs to, when it isn't one itself. */
  project: string | null
  state: StepState
  why?: string
}

export const PLAN_KEY = 'daily-tracking-tool:plan'
export const MAX_STEPS = 5

/** The plan as stored, only if it is today's. */
export function planFor(raw: unknown, today: string): DayPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const { date, ids, why } = raw as Partial<DayPlan>
  if (date !== today || !Array.isArray(ids)) return null
  const clean = [...new Set(ids.filter((id): id is string => typeof id === 'string'))].slice(0, MAX_STEPS)
  if (!clean.length) return null
  const reasons = why && typeof why === 'object' ? Object.fromEntries(Object.entries(why).filter(([, v]) => typeof v === 'string')) : undefined
  return { date, ids: clean, ...(reasons && Object.keys(reasons).length ? { why: reasons } : {}) }
}

/** The root ancestor's name, for a task that hangs from a project. */
export function projectOf(byId: Map<string, Task>, task: Task): string | null {
  let root = task
  for (let p = task.parentId ? byId.get(task.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) root = p
  return root === task ? null : root.text.trim() || 'Sin título'
}

/**
 * The plan as steps, in its order. Tasks deleted, emptied or postponed past
 * today drop out. «Ahora» is the first one still open; the rest are done or next.
 */
export function planSteps(plan: DayPlan | null, tasks: Task[], today: string): PlanStep[] {
  if (!plan) return []
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const live = plan.ids
    .map((id) => byId.get(id))
    .filter((t): t is Task => Boolean(t && t.text.trim() && !(t.snooze && t.snooze.until > today)))
  let current = false
  return live.map((task) => {
    let state: StepState = 'done'
    if (task.status !== 'done') {
      state = current ? 'next' : 'now'
      current = true
    }
    return { task, project: projectOf(byId, task), state, ...(plan.why?.[task.id] ? { why: plan.why[task.id] } : {}) }
  })
}

/** Index of «Ahora», or the number of steps when everything is done. */
export const currentIndex = (steps: PlanStep[]) => {
  const at = steps.findIndex((s) => s.state === 'now')
  return at < 0 ? steps.length : at
}

/**
 * Adds the task to the end of the plan or takes it out. Ids that no longer
 * name a live task are dropped first, so they don't count against the limit.
 * `full` when there was no room.
 */
export function togglePlanned(plan: DayPlan | null, id: string, tasks: Task[], today: string): { plan: DayPlan | null; full: boolean } {
  const live = new Set(tasks.map((t) => t.id))
  const ids = (plan?.date === today ? plan.ids : []).filter((x) => live.has(x))
  const why = plan?.date === today ? plan.why : undefined
  if (ids.includes(id)) {
    const rest = ids.filter((x) => x !== id)
    return { plan: rest.length ? { date: today, ids: rest, ...(why ? { why } : {}) } : null, full: false }
  }
  if (ids.length >= MAX_STEPS) return { plan: plan?.date === today ? plan : null, full: true }
  return { plan: { date: today, ids: [...ids, id], ...(why ? { why } : {}) }, full: false }
}

/**
 * A plan from what the AI picked: the tasks it planned for today, in its order,
 * with its reasons. Picks the proposal left unplanned (or removed) are skipped.
 */
export function planFromPicks(picks: { id: string; why?: string }[], next: Task[], today: string): DayPlan | null {
  const byId = new Map(next.map((t) => [t.id, t]))
  const kept = picks.filter((p, i) => picks.findIndex((q) => q.id === p.id) === i && byId.get(p.id)?.due === today && byId.get(p.id)?.status !== 'done')
  if (!kept.length) return null
  const chosen = kept.slice(0, MAX_STEPS)
  const why = Object.fromEntries(chosen.filter((p) => p.why?.trim()).map((p) => [p.id, p.why!.trim()]))
  return { date: today, ids: chosen.map((p) => p.id), ...(Object.keys(why).length ? { why } : {}) }
}

function read(today: string): DayPlan | null {
  try {
    return planFor(JSON.parse(localStorage.getItem(PLAN_KEY) ?? 'null'), today)
  } catch {
    return null
  }
}

/** Today's plan, kept in this browser and shared with other open tabs. */
export function usePlan(today: string) {
  const [plan, setPlanState] = useState<DayPlan | null>(() => read(today))
  // Past midnight the old plan simply stops applying.
  const current = plan?.date === today ? plan : null

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PLAN_KEY) setPlanState(read(today))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [today])

  const setPlan = useCallback((next: DayPlan | null) => {
    setPlanState(next)
    try {
      if (next) localStorage.setItem(PLAN_KEY, JSON.stringify(next))
      else localStorage.removeItem(PLAN_KEY)
    } catch {
      // Not critical: the plan just won't survive a reload.
    }
  }, [])

  return [current, setPlan] as const
}
