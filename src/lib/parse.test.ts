import { describe, expect, it } from 'vitest'
import { dueLabel, parseOutline, parseTask, resolveDate } from './parse'

// Monday 28 Sep 2026, midday.
const now = new Date(2026, 8, 28, 12)

describe('parseTask', () => {
  it('reads tags, priority and a trailing date', () => {
    expect(parseTask('Llamar a IT mañana #zimvie !', now)).toEqual({
      text: 'Llamar a IT',
      tags: ['zimvie'],
      priority: true,
      due: '2026-09-29',
    })
  })

  it('reads "pasado mañana", weekdays and @dates anywhere', () => {
    expect(parseTask('Informe pasado mañana', now).due).toBe('2026-09-30')
    expect(parseTask('Demo viernes', now)).toMatchObject({ text: 'Demo', due: '2026-10-02' })
    expect(parseTask('Revisar @lunes la oferta', now)).toMatchObject({ text: 'Revisar la oferta', due: '2026-10-05' })
  })

  it('leaves dates in the middle of a sentence alone', () => {
    expect(parseTask('Informe de mañana para Ana', now)).toMatchObject({ text: 'Informe de mañana para Ana', due: null })
  })

  it('never turns a lone date word into an empty task', () => {
    expect(parseTask('Mañana', now)).toMatchObject({ text: 'Mañana', due: null })
  })

  it('keeps exclamations that are part of the text', () => {
    expect(parseTask('¡Hecho!', now)).toMatchObject({ text: '¡Hecho!', priority: false })
  })
})

describe('resolveDate', () => {
  it('handles numeric dates and rolls past ones into next year', () => {
    expect(resolveDate('3/10', now)).toBe('2026-10-03')
    expect(resolveDate('5/1', now)).toBe('2027-01-05')
    expect(resolveDate('31/2', now)).toBeNull()
  })
})

describe('dueLabel', () => {
  it('names nearby days', () => {
    expect(dueLabel('2026-09-28', now)).toBe('Hoy')
    expect(dueLabel('2026-09-29', now)).toBe('Mañana')
    expect(dueLabel('2026-09-27', now)).toBe('Ayer')
  })
})

describe('parseOutline', () => {
  it('turns indentation and tree drawings into depth', () => {
    const pasted = ['☐ Proyecto ZimVie', '├─ ☑ Revisar alarmas', '├─ ☐ Validar torno 04', '│ └─ ☐ Consultar IT', '└─ ☐ Preparar informe', '☐ Formación GitHub Copilot'].join('\n')
    expect(parseOutline(pasted)).toEqual([
      { text: 'Proyecto ZimVie', depth: 0, done: false },
      { text: 'Revisar alarmas', depth: 1, done: true },
      { text: 'Validar torno 04', depth: 1, done: false },
      { text: 'Consultar IT', depth: 2, done: false },
      { text: 'Preparar informe', depth: 1, done: false },
      { text: 'Formación GitHub Copilot', depth: 0, done: false },
    ])
  })

  it('strips markdown bullets and checkboxes', () => {
    expect(parseOutline('- [x] Uno\n\t- Dos\n\t* [ ] Tres\n1. Cuatro')).toEqual([
      { text: 'Uno', depth: 0, done: true },
      { text: 'Dos', depth: 1, done: false },
      { text: 'Tres', depth: 1, done: false },
      { text: 'Cuatro', depth: 0, done: false },
    ])
  })
})
