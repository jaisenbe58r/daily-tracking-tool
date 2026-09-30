import { dateKey, fold } from './parse'
import type { Repeat, Task } from './types'
import * as tree from './tree'

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']

const fromKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6

/** The occurrence after `key` (YYYY-MM-DD). Monthly keeps the day, clamped to short months. */
export function step(repeat: Repeat, key: string, anchorDay = fromKey(key).getDate()): string {
  const d = fromKey(key)
  if (repeat === 'daily') d.setDate(d.getDate() + 1)
  else if (repeat === 'weekly') d.setDate(d.getDate() + 7)
  else if (repeat === 'weekdays') {
    do d.setDate(d.getDate() + 1)
    while (isWeekend(d))
  } else {
    const month = d.getMonth() + 1
    const last = new Date(d.getFullYear(), month + 1, 0).getDate()
    d.setFullYear(d.getFullYear(), month, Math.min(anchorDay, last))
  }
  return dateKey(d)
}

/** Next date strictly after today, following the rule from the task's own date. */
export function nextDue(repeat: Repeat, due: string | null, today: string): string {
  const anchor = due ?? today
  const day = fromKey(anchor).getDate()
  let next = step(repeat, anchor, day)
  while (next <= today) next = step(repeat, next, day)
  return next
}

export const REPEAT_LABEL: Record<Repeat, string> = {
  daily: 'Cada día',
  weekdays: 'Cada día laborable',
  weekly: 'Cada semana',
  monthly: 'Cada mes',
}

/** "Cada lunes" reads better than "Cada semana" when the date says which day. */
export function repeatLabel(repeat: Repeat, due: string | null): string {
  if (repeat === 'weekly' && due) return `Cada ${WEEKDAYS[fromKey(due).getDay()].replace('miercoles', 'miércoles').replace('sabado', 'sábado')}`
  return REPEAT_LABEL[repeat]
}

export interface ParsedRepeat {
  text: string
  repeat: Repeat
  /** First occurrence when the phrase names a weekday ("cada lunes"). */
  due: string | null
}

// Only at the end of the line, like dates, so "revisar cada semana el informe" can be written as is.
const TRAILING =
  /(?:^|\s)(cada\s+(?:d[ií]a\s+laborable|d[ií]a|semana|mes|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)|todos\s+los\s+d[ií]as|entre\s+semana)$/iu

/** Reads a trailing recurrence phrase ("cada día", "cada lunes", "entre semana"…). */
export function parseRepeat(text: string, now: Date): ParsedRepeat | null {
  const trimmed = text.trimEnd()
  const m = trimmed.match(TRAILING)
  if (!m || m.index === undefined || !trimmed.slice(0, m.index).trim()) return null
  const phrase = fold(m[1]).replace(/\s+/g, ' ')
  const rest = trimmed.slice(0, m.index).trimEnd()
  const today = dateKey(now)
  if (phrase === 'cada dia' || phrase === 'todos los dias') return { text: rest, repeat: 'daily', due: null }
  if (phrase === 'cada dia laborable' || phrase === 'entre semana') return { text: rest, repeat: 'weekdays', due: null }
  if (phrase === 'cada semana') return { text: rest, repeat: 'weekly', due: null }
  if (phrase === 'cada mes') return { text: rest, repeat: 'monthly', due: null }
  const weekday = WEEKDAYS.indexOf(phrase.slice(5))
  const ahead = (weekday - now.getDay() + 7) % 7
  const d = new Date(now)
  d.setDate(d.getDate() + ahead)
  return { text: rest, repeat: 'weekly', due: ahead === 0 ? today : dateKey(d) }
}

/** First date for a new recurring task without one: today, or Monday for weekday tasks at the weekend. */
export function firstDue(repeat: Repeat, today: string): string {
  return repeat === 'weekdays' && isWeekend(fromKey(today)) ? nextDue('weekdays', today, today) : today
}

/**
 * Completing a recurring task plants the next occurrence right after it, with
 * its subtasks reset to open, and hands the rule over to it: reopening the old
 * one never plants a second copy.
 */
export function plantNext(tasks: Task[], id: string, today: string): Task[] {
  const done = tasks.find((t) => t.id === id)
  if (!done?.repeat) return tasks
  const next: Task = {
    ...tree.newTask(done.parentId, done.text),
    notes: done.notes,
    tags: done.tags,
    priority: done.priority,
    repeat: done.repeat,
    due: nextDue(done.repeat, done.due, today),
  }
  const after = tree.nextSibling(tasks, id)
  let out = tree.update(tasks, id, { repeat: null })
  out = tree.place(out, next, done.parentId, after?.id ?? null)
  // Copy the checklist under it, fresh.
  const copy = (from: string, to: string) => {
    for (const child of tree.childrenOf(tasks, from)) {
      const clone: Task = { ...tree.newTask(to, child.text), notes: child.notes, tags: child.tags, priority: child.priority }
      out = tree.place(out, clone, to, null)
      copy(child.id, clone.id)
    }
  }
  copy(id, next.id)
  return out
}
