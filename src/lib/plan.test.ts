import { describe, expect, it } from 'vitest'
import { picksOf } from '../ai/ops'
import { MAX_STEPS, currentIndex, planFor, planFromPicks, planSteps, togglePlanned, type DayPlan } from './plan'
import { newTask } from './tree'
import type { Task } from './types'

const today = '2026-10-01'
const t = (id: string, parentId: string | null = null, extra: Partial<Task> = {}): Task => ({ ...newTask(parentId, id), id, ...extra })
const plan = (...ids: string[]): DayPlan => ({ date: today, ids })
const states = (tasks: Task[], p: DayPlan | null) => planSteps(p, tasks, today).map((s) => `${s.task.id}:${s.state}`)

describe('planFor', () => {
  it('keeps only today’s plan', () => {
    expect(planFor({ date: today, ids: ['a', 'b'] }, today)).toEqual(plan('a', 'b'))
    expect(planFor({ date: '2026-09-30', ids: ['a'] }, today)).toBeNull()
    expect(planFor(null, today)).toBeNull()
    expect(planFor({ date: today, ids: [] }, today)).toBeNull()
  })

  it('drops junk, repeats and anything past the limit', () => {
    const ids = ['a', 'a', 3, 'b', 'c', 'd', 'e', 'f', 'g']
    expect(planFor({ date: today, ids, why: { a: 'vence hoy', b: 7 } }, today)).toEqual({
      date: today,
      ids: ['a', 'b', 'c', 'd', 'e'],
      why: { a: 'vence hoy' },
    })
  })
})

describe('planSteps', () => {
  it('keeps the plan’s order and makes the first open step «Ahora»', () => {
    const tasks = [t('a'), t('b', null, { status: 'done' }), t('c')]
    expect(states(tasks, plan('b', 'c', 'a'))).toEqual(['b:done', 'c:now', 'a:next'])
  })

  it('advances «Ahora» as tasks get done, past steps done out of order', () => {
    const tasks = [t('a', null, { status: 'done' }), t('b'), t('c', null, { status: 'done' })]
    const steps = planSteps(plan('a', 'b', 'c'), tasks, today)
    expect(steps.map((s) => s.state)).toEqual(['done', 'now', 'done'])
    expect(currentIndex(steps)).toBe(1)
    const all = planSteps(plan('a', 'c'), tasks, today)
    expect(currentIndex(all)).toBe(2)
  })

  it('drops deleted, emptied and postponed tasks', () => {
    const tasks = [t('a'), t('b', null, { text: '  ' }), t('c', null, { snooze: { until: '2026-10-05', since: today } }), t('d', null, { snooze: { until: today, since: '2026-09-30' } })]
    expect(states(tasks, plan('gone', 'a', 'b', 'c', 'd'))).toEqual(['a:now', 'd:next'])
  })

  it('names the root project and carries the reason', () => {
    const tasks = [t('ZimVie'), t('Torno', 'ZimVie'), t('Validar', 'Torno')]
    const [step] = planSteps({ date: today, ids: ['Validar'], why: { Validar: 'bloquea la entrega' } }, tasks, today)
    expect(step.project).toBe('ZimVie')
    expect(step.why).toBe('bloquea la entrega')
    expect(planSteps(plan('ZimVie'), tasks, today)[0].project).toBeNull()
  })
})

describe('togglePlanned', () => {
  const tasks = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => t(id))

  it('adds at the end and takes out again', () => {
    const added = togglePlanned(plan('a'), 'b', tasks, today)
    expect(added).toEqual({ plan: plan('a', 'b'), full: false })
    expect(togglePlanned(added.plan, 'a', tasks, today).plan).toEqual(plan('b'))
    expect(togglePlanned(plan('a'), 'a', tasks, today).plan).toBeNull()
  })

  it('starts fresh over yesterday’s plan', () => {
    expect(togglePlanned({ date: '2026-09-30', ids: ['a', 'b'] }, 'c', tasks, today).plan).toEqual(plan('c'))
  })

  it(`stops at ${MAX_STEPS} steps, not counting deleted tasks`, () => {
    const full = plan('a', 'b', 'c', 'd', 'e')
    expect(togglePlanned(full, 'f', tasks, today)).toEqual({ plan: full, full: true })
    expect(togglePlanned(plan('a', 'b', 'c', 'd', 'gone'), 'f', tasks, today).plan).toEqual(plan('a', 'b', 'c', 'd', 'f'))
  })
})

describe('planFromPicks', () => {
  it('keeps the AI’s order and reasons for what it planned today', () => {
    const next = [t('a', null, { due: today }), t('b', null, { due: today }), t('c', null, { due: '2026-10-03' })]
    const refs = new Map([['t1', 'a'], ['t2', 'b'], ['t3', 'c']])
    const picks = picksOf(
      [
        { op: 'update', id: 't2', due: today, priority: true, why: ' vence hoy ' },
        { op: 'update', id: 't3', due: '2026-10-03' },
        { op: 'add', text: 'Nueva' },
        { op: 'update', id: 't1', due: today, priority: true },
        { op: 'update', id: 't9' },
      ],
      refs,
    )
    expect(planFromPicks(picks, next, today)).toEqual({ date: today, ids: ['b', 'a'], why: { b: 'vence hoy' } })
    expect(planFromPicks([], next, today)).toBeNull()
  })
})
