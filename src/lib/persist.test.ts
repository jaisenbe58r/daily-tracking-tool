import { describe, expect, it } from 'vitest'
import { parse, sanitize } from './persist'

describe('persist', () => {
  it('returns nothing for garbage', () => {
    expect(parse('not json')).toEqual([])
    expect(parse('{"tasks": 3}')).toEqual([])
    expect(parse(null)).toEqual([])
  })

  it('fills missing fields and drops invalid entries', () => {
    const [t, ...rest] = sanitize([{ id: 'a', text: 'Hola', status: 'weird', tags: ['x', 'x', 3] }, { text: 'sin id' }, null])
    expect(rest).toEqual([])
    expect(t).toMatchObject({ id: 'a', text: 'Hola', status: 'todo', tags: ['x'], parentId: null, notes: '', collapsed: false })
  })

  it('re-roots orphans and breaks parent cycles', () => {
    const tasks = sanitize([
      { id: 'a', parentId: 'ghost' },
      { id: 'b', parentId: 'c' },
      { id: 'c', parentId: 'b' },
      { id: 'a', text: 'duplicado' },
    ])
    expect(tasks.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(tasks[0].parentId).toBeNull()
    expect(tasks.filter((t) => t.parentId === null).length).toBeGreaterThanOrEqual(2)
  })
})
