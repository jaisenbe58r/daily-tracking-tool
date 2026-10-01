import { describe, expect, it } from 'vitest'
import { candidates, markPhrase } from './autoMark'
import { newTask } from '../lib/tree'
import { sanitize } from '../lib/persist'

describe('markPhrase', () => {
  it('highlights the phrase where it is', () => {
    expect(markPhrase('Enviar oferta a ZimVie antes del viernes', 'antes del viernes')).toBe('Enviar oferta a ZimVie ==antes del viernes==')
  })

  it('drops phrases that are not in the text word for word', () => {
    expect(markPhrase('Enviar oferta a ZimVie', 'oferta ZimVie')).toBeNull()
    expect(markPhrase('Preparar la demostración', 'demo')).toBeNull()
  })

  it('drops phrases that are most of the task or too long', () => {
    expect(markPhrase('Revisar alarmas torno', 'Revisar alarmas torno')).toBeNull()
    expect(markPhrase('Llamar a IT para que revise las alarmas del torno 04 esta semana sin falta', 'que revise las alarmas del torno 04')).toBeNull()
  })

  it('keeps tags and markers out', () => {
    expect(markPhrase('Validar torno 04 #zimvie hoy', '04 #zimvie')).toBeNull()
    expect(markPhrase('Validar torno 04 hoy mismo', '«torno 04»')).toBe('Validar ==torno 04== hoy mismo')
  })
})

describe('candidates', () => {
  const now = Date.now()
  const task = (text: string, patch = {}) => ({ ...newTask(null, text), createdAt: now, ...patch })

  it('takes fresh, open, unmarked tasks of a few words', () => {
    const fresh = task('Preparar informe para ZimVie')
    const list = [
      fresh,
      task('Corto'),
      task('Ya visto por la IA', { autoMarked: true }),
      task('Hecha hace un rato ya', { status: 'done' }),
      task('Escrita hace mucho tiempo', { createdAt: now - 3_600_000 }),
      task('Ya con un ==subrayado== puesto'),
    ]
    expect(candidates(list, now, null)).toEqual([fresh])
    expect(candidates(list, now, fresh.id)).toEqual([])
  })

  it('remembers the flag across saves', () => {
    expect(sanitize([task('Una tarea cualquiera', { autoMarked: true })])[0].autoMarked).toBe(true)
    expect('autoMarked' in sanitize([task('Otra tarea cualquiera')])[0]).toBe(false)
  })
})
