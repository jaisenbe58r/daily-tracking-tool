import { describe, expect, it } from 'vitest'
import { complete, peopleIn, suggestions, tokenAt } from './suggest'

const now = new Date('2026-10-01T12:00')

describe('suggest', () => {
  it('finds the #tag or @name being typed', () => {
    expect(tokenAt('Llamar a IT #zi', 15)).toEqual({ kind: '#', start: 12, prefix: 'zi' })
    expect(tokenAt('Revisar con @', 13)).toEqual({ kind: '@', start: 12, prefix: '' })
    expect(tokenAt('correo@captia', 13)).toBeNull()
    expect(tokenAt('Llamar #zimvie hoy', 10)).toBeNull()
  })

  it('lists tags and people, most used first, then date words for @', () => {
    const pool = { tags: ['zimvie', 'captia', 'zeiss'], people: ['luis', 'marta'] }
    expect(suggestions({ kind: '#', start: 0, prefix: 'z' }, pool)).toEqual(['zimvie', 'zeiss'])
    expect(suggestions({ kind: '#', start: 0, prefix: 'vie' }, pool)).toEqual(['zimvie'])
    expect(suggestions({ kind: '@', start: 0, prefix: 'ma' }, pool)).toEqual(['marta', 'mañana', 'martes'])
    expect(suggestions({ kind: '#', start: 0, prefix: 'zimvie' }, pool)).toEqual([])
  })

  it('collects people but not dates', () => {
    const tasks = [{ text: 'Llamar a @luis @viernes', notes: '' }, { text: 'Ver con @Marta y @luis', notes: '' }]
    expect(peopleIn(tasks, now)).toEqual(['luis', 'marta'])
  })

  it('completes the word and leaves the caret after a space', () => {
    expect(complete('Llamar #zi', { kind: '#', start: 7, prefix: 'zi' }, 10, 'zimvie')).toEqual({ text: 'Llamar #zimvie ', caret: 15 })
    expect(complete('Ver @ma mañana', { kind: '@', start: 4, prefix: 'ma' }, 7, 'marta')).toEqual({ text: 'Ver @marta mañana', caret: 11 })
  })
})
