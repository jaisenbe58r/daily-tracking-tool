import { describe, expect, it } from 'vitest'
import { carryOver } from './daily'
import { daysAway, hideSnoozed, isBack, resolveSnooze, snoozeChoices, wake, workingDaysAhead } from './snooze'
import { sanitize } from './persist'
import { flatten, newTask } from './tree'
import type { Task } from './types'

// Wednesday 30 September 2026.
const now = new Date(2026, 8, 30, 10)
const today = '2026-09-30'
const t = (id: string, parentId: string | null, extra: Partial<Task> = {}): Task => ({ ...newTask(parentId, id), id, createdAt: now.getTime(), ...extra })
const away = (until: string, since = today) => ({ snooze: { until, since } })
const ids = (tasks: Task[]) => flatten(tasks).map((r) => `${'  '.repeat(r.depth)}${r.task.id}`)

describe('resolveSnooze', () => {
  it('reads days, weekdays, spans and next week', () => {
    expect(resolveSnooze('mañana', now)).toBe('2026-10-01')
    expect(resolveSnooze('lunes', now)).toBe('2026-10-05')
    expect(resolveSnooze('el viernes', now)).toBe('2026-10-02')
    expect(resolveSnooze('15/10', now)).toBe('2026-10-15')
    expect(resolveSnooze('3 días', now)).toBe('2026-10-03')
    expect(resolveSnooze('en 2 semanas', now)).toBe('2026-10-14')
    expect(resolveSnooze('próxima semana', now)).toBe('2026-10-05')
  })

  it('refuses today, the past and words that are not dates', () => {
    expect(resolveSnooze('hoy', now)).toBeNull()
    expect(resolveSnooze('0 días', now)).toBeNull()
    expect(resolveSnooze('informe', now)).toBeNull()
  })
})

describe('choices', () => {
  it('skips weekends when counting working days', () => {
    // Wednesday + 3 working days = Monday.
    expect(workingDaysAhead(now, 3)).toBe('2026-10-05')
  })

  it('offers three working days first when waiting, without repeating a date', () => {
    const waiting = snoozeChoices(now, true)
    expect(waiting[0]).toEqual({ label: '3 días laborables', until: '2026-10-05' })
    // "El lunes" is the same day, so it's left out.
    expect(waiting.map((c) => c.label)).toEqual(['3 días laborables', 'Mañana', 'Pasado mañana', 'En una semana'])
    expect(snoozeChoices(now, false).map((c) => c.label)).toEqual(['Mañana', 'Pasado mañana', 'El lunes', 'En una semana'])
  })
})

describe('hideSnoozed', () => {
  it('hides a postponed task with its subtasks until its day', () => {
    const tasks = [t('a', null, away('2026-10-02')), t('child', 'a'), t('b', null), t('back', null, away(today, '2026-09-27'))]
    expect(hideSnoozed(tasks, today).map((x) => x.id)).toEqual(['b', 'back'])
    expect(hideSnoozed(tasks, '2026-10-02').map((x) => x.id)).toEqual(['a', 'child', 'b', 'back'])
  })

  it('returns the same list when nothing is postponed', () => {
    const tasks = [t('a', null)]
    expect(hideSnoozed(tasks, today)).toBe(tasks)
  })
})

describe('coming back', () => {
  it('raises tasks whose day has come above yesterday’s leftovers', () => {
    const tasks = [
      t('new', null),
      t('stale', null, { createdAt: now.getTime() - 2 * 86_400_000 }),
      t('back', null, away(today, '2026-09-25')),
      t('child', 'back'),
      t('later', null, away('2026-10-05')),
    ]
    const out = carryOver(tasks, today, '2026-09-29')
    expect(ids(out)).toEqual(['back', '  child', 'stale', 'new', 'later'])
    const back = out.find((x) => x.id === 'back')!
    expect(isBack(back, today)).toBe(true)
    expect(daysAway(back)).toBe(5)
  })

  it('shows the mark for one day only, even if the sheet was not opened on that day', () => {
    // Due back on Saturday, first opened again on Monday: it's back now, with its mark.
    const missed = [t('a', null, away('2026-10-03', today))]
    expect(wake(missed, '2026-10-05', today).tasks[0].snooze).not.toBeNull()
    // Seen on Monday; on Tuesday the mark goes.
    expect(wake(missed, '2026-10-06', '2026-10-05').tasks[0].snooze).toBeNull()
  })
})

describe('storage', () => {
  it('keeps a valid snooze and drops a broken one', () => {
    const [ok, broken] = sanitize([
      { id: 'a', snooze: { until: '2026-10-05', since: today } },
      { id: 'b', snooze: { until: 'lunes' } },
    ])
    expect(ok.snooze).toEqual({ until: '2026-10-05', since: today })
    expect(broken.snooze).toBeNull()
  })
})
