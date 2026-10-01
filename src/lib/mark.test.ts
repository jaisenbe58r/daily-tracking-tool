import { describe, expect, it } from 'vitest'
import { hasMark, plain, segments, toggleMark } from './mark'

describe('segments', () => {
  it('cuts the text into plain and highlighted runs', () => {
    expect(segments('Tus datos. ==Se queda en la máquina.== Fin')).toEqual([
      { text: 'Tus datos. ', marked: false },
      { text: 'Se queda en la máquina.', marked: true },
      { text: ' Fin', marked: false },
    ])
  })

  it('keeps the markers for the editor', () => {
    expect(segments('a ==b==', true).map((s) => s.text).join('')).toBe('a ==b==')
  })

  it('ignores empty or spaced markers', () => {
    expect(hasMark('a ==== b')).toBe(false)
    expect(hasMark('a == b ==')).toBe(false)
    expect(hasMark('x == y')).toBe(false)
    expect(hasMark('==y==')).toBe(true)
  })

  it('strips markers for plain text', () => {
    expect(plain('Revisar ==torno 04== hoy')).toBe('Revisar torno 04 hoy')
  })
})

describe('toggleMark', () => {
  it('highlights the selected words', () => {
    expect(toggleMark('Revisar torno 04 hoy', 8, 16)).toEqual({ text: 'Revisar ==torno 04== hoy', start: 10, end: 18 })
  })

  it('trims spaces from the selection', () => {
    expect(toggleMark('Revisar torno 04 hoy', 7, 17).text).toBe('Revisar ==torno 04== hoy')
  })

  it('highlights the whole task when nothing is selected', () => {
    expect(toggleMark('Preparar demo', 3, 3).text).toBe('==Preparar demo==')
  })

  it('clears the highlight under the caret or selection', () => {
    expect(toggleMark('Revisar ==torno 04== hoy', 12, 12)).toEqual({ text: 'Revisar torno 04 hoy', start: 10, end: 10 })
    expect(toggleMark('Revisar ==torno 04== hoy', 10, 18).text).toBe('Revisar torno 04 hoy')
    expect(toggleMark('==Preparar demo==', 17, 17).text).toBe('Preparar demo')
  })

  it('merges highlights inside a wider selection', () => {
    expect(toggleMark('a ==b== c', 0, 9).text).toBe('==a b c==')
  })

  it('leaves an empty task alone', () => {
    expect(toggleMark('  ', 0, 0).text).toBe('  ')
  })
})
