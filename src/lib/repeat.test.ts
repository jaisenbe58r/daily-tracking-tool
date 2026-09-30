import { describe, expect, it } from 'vitest'
import { parseTask } from './parse'
import { nextDue, plantNext, repeatLabel } from './repeat'
import { newTask } from './tree'
import type { Task } from './types'

// Wednesday 30 September 2026, midday.
const now = new Date(2026, 8, 30, 12)
const today = '2026-09-30'

describe('recurrence grammar', () => {
  it('reads trailing phrases and plans the first occurrence', () => {
    expect(parseTask('Standup cada día', now)).toMatchObject({ text: 'Standup', repeat: 'daily', due: today })
    expect(parseTask('Revisar correo todos los días #rutina', now)).toMatchObject({ text: 'Revisar correo', repeat: 'daily', tags: ['rutina'] })
    expect(parseTask('Informe cada viernes !', now)).toMatchObject({ text: 'Informe', repeat: 'weekly', due: '2026-10-02', priority: true })
    expect(parseTask('Revisión cada miércoles', now)).toMatchObject({ repeat: 'weekly', due: today })
    expect(parseTask('Fichar entre semana', now)).toMatchObject({ text: 'Fichar', repeat: 'weekdays', due: today })
    expect(parseTask('Pagar alquiler cada mes 1/10', now)).toMatchObject({ text: 'Pagar alquiler', repeat: 'monthly', due: '2026-10-01' })
  })

  it('leaves the phrase alone when it is not at the end', () => {
    expect(parseTask('Revisar cada semana el informe', now)).toMatchObject({ text: 'Revisar cada semana el informe', repeat: null })
    expect(parseTask('cada día', now)).toMatchObject({ text: 'cada día', repeat: null })
    expect(parseTask('Informe semanal', now)).toMatchObject({ repeat: null })
  })
})

describe('next occurrence', () => {
  it('steps from the date, always landing after today', () => {
    expect(nextDue('daily', today, today)).toBe('2026-10-01')
    expect(nextDue('daily', '2026-09-20', today)).toBe('2026-10-01')
    expect(nextDue('weekly', '2026-09-25', today)).toBe('2026-10-02')
    expect(nextDue('weekdays', '2026-10-02', '2026-10-02')).toBe('2026-10-05')
    expect(nextDue('monthly', '2026-01-31', '2026-01-31')).toBe('2026-02-28')
    expect(nextDue('monthly', '2026-02-28', '2026-02-28')).toBe('2026-03-28')
  })

  it('names the weekday of weekly tasks', () => {
    expect(repeatLabel('weekly', '2026-10-02')).toBe('Cada viernes')
    expect(repeatLabel('daily', null)).toBe('Cada día')
  })
})

describe('plantNext', () => {
  it('plants a fresh copy after the done task, with its checklist', () => {
    const a: Task = { ...newTask(null, 'Cierre semanal'), status: 'done', repeat: 'weekly', due: today, tags: ['equipo'] }
    const a1: Task = { ...newTask(a.id, 'Enviar horas'), status: 'done', completedAt: 1 }
    const b = newTask(null, 'Otra')
    const out = plantNext([a, a1, b], a.id, today)
    const roots = out.filter((t) => t.parentId === null)
    expect(roots.map((t) => t.text)).toEqual(['Cierre semanal', 'Cierre semanal', 'Otra'])
    const [old, next] = roots
    expect(old).toMatchObject({ status: 'done', repeat: null })
    expect(next).toMatchObject({ status: 'todo', repeat: 'weekly', due: '2026-10-07', tags: ['equipo'] })
    expect(out.filter((t) => t.parentId === next.id)).toMatchObject([{ text: 'Enviar horas', status: 'todo' }])
  })

  it('does nothing for one-off tasks', () => {
    const tasks = [newTask(null, 'Una vez')]
    expect(plantNext(tasks, tasks[0].id, today)).toBe(tasks)
  })
})
