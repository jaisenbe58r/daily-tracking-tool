import { describe, expect, it } from 'vitest'
import { jsonSchema, readPartial, validate } from './tools'

describe('readPartial', () => {
  it('reads half-written JSON, after a fence or a sentence', () => {
    expect(readPartial('```json\n{"summary": "Dos tar')).toEqual({ summary: 'Dos tar' })
    expect(readPartial('Aquí va: {"ops": [{"op": "add", "text": "Llamar')).toEqual({ ops: [{ op: 'add', text: 'Llamar' }] })
  })
  it('passes objects through and ignores text with no object yet', () => {
    expect(readPartial({ text: 'hola' })).toEqual({ text: 'hola' })
    expect(readPartial('Pensando')).toBeNull()
  })
})

describe('jsonSchema', () => {
  it('is plain JSON Schema for the tool', () => {
    const schema = jsonSchema('select_tasks')
    expect(schema.$schema).toBeUndefined()
    expect(schema.type).toBe('object')
    expect(Object.keys(schema.properties as object)).toEqual(['ids', 'summary'])
  })
})

describe('validate', () => {
  it('rejects an answer of the wrong shape', () => {
    expect(validate('write_text', { text: 'Hecho' })).toEqual({ text: 'Hecho' })
    expect(() => validate('write_text', { ops: [] })).toThrow('La IA no devolvió una respuesta válida')
  })
})
