import { describe, expect, it } from 'vitest'
import type { Task } from './types'
import * as tree from './tree'

const make = (...specs: [string, string | null][]): Task[] =>
  specs.map(([id, parentId]) => ({ ...tree.newTask(parentId, id), id }))

const shape = (tasks: Task[]) => tree.flatten(tasks).map((r) => `${'  '.repeat(r.depth)}${r.task.id}`)

describe('tree', () => {
  it('flattens depth-first in manual order', () => {
    const t = make(['a', null], ['b', null], ['a1', 'a'], ['a2', 'a'])
    expect(shape(t)).toEqual(['a', '  a1', '  a2', 'b'])
  })

  it('inserts a sibling after, or a first child of an expanded parent', () => {
    let t = make(['a', null], ['b', null])
    t = tree.insertAfter(t, 'a', { ...tree.newTask(), id: 'x' })
    expect(shape(t)).toEqual(['a', 'x', 'b'])
    t = tree.insertAfter(tree.indent(t, 'x'), 'a', { ...tree.newTask(), id: 'y' })
    expect(shape(t)).toEqual(['a', '  y', '  x', 'b'])
  })

  it('indents under the previous sibling and outdents after the parent', () => {
    let t = make(['a', null], ['b', null], ['c', null])
    t = tree.indent(t, 'b')
    expect(shape(t)).toEqual(['a', '  b', 'c'])
    expect(tree.indent(t, 'b')).toBe(t)
    t = tree.outdent(t, 'b')
    expect(shape(t)).toEqual(['a', 'b', 'c'])
  })

  it('moves among siblings', () => {
    const t = make(['a', null], ['b', null], ['c', null])
    expect(shape(tree.moveUp(t, 'c'))).toEqual(['a', 'c', 'b'])
    expect(shape(tree.moveDown(t, 'a'))).toEqual(['b', 'a', 'c'])
  })

  it('removing a parent promotes its children in place', () => {
    const t = make(['a', null], ['b', null], ['b1', 'b'], ['b2', 'b'], ['c', null])
    expect(shape(tree.remove(t, 'b'))).toEqual(['a', 'b1', 'b2', 'c'])
  })

  it('moves a subtree and refuses to drop it into itself', () => {
    const t = make(['a', null], ['a1', 'a'], ['b', null])
    expect(shape(tree.moveTo(t, 'a', 'b', null))).toEqual(['b', '  a', '    a1'])
    expect(tree.moveTo(t, 'a', 'a1', null)).toBe(t)
  })

  it('hides children of collapsed tasks', () => {
    const t = tree.update(make(['a', null], ['a1', 'a']), 'a', { collapsed: true })
    expect(shape(t)).toEqual(['a'])
  })

  it('extracts #tags from text', () => {
    expect(tree.extractTags('Preparar demo #Captia #urgente')).toEqual({ text: 'Preparar demo', tags: ['captia', 'urgente'] })
    expect(tree.extractTags('C#  sin tag')).toEqual({ text: 'C# sin tag', tags: [] })
  })
})
