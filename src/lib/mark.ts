/**
 * Subrayado: `==una frase==` puts a solid green block behind those words, the
 * Captia way ("Se queda en la máquina."). The markers stay in the text, so it
 * syncs and travels like any other text; only the views draw them.
 */

export interface Segment {
  text: string
  marked: boolean
}

const MARK = /==(?=\S)(.*?\S)==/g

export const hasMark = (text: string) => new RegExp(MARK.source).test(text)

/** The text cut into plain and highlighted runs; `withSigns` keeps the `==` on the runs' edges (for the editor, whose glyphs must line up). */
export function segments(text: string, withSigns = false): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(MARK)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), marked: false })
    out.push({ text: withSigns ? m[0] : m[1], marked: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), marked: false })
  return out
}

/** The text without markers, for places that show it plainly. */
export const plain = (text: string) => text.replace(MARK, '$1')

/**
 * Alt+U or `/` Subrayar. With words selected: highlight them, or clear the
 * highlight they sit in. With nothing selected: clear the highlight under the
 * caret, else highlight (or clear) the whole task.
 */
export function toggleMark(text: string, start: number, end: number): { text: string; start: number; end: number } {
  for (const m of text.matchAll(MARK)) {
    const from = m.index
    const to = from + m[0].length
    if (start >= from && end <= to && (start < to || start === end)) {
      const inner = m[1]
      const shift = (n: number) => Math.min(Math.max(n - from - 2, 0), inner.length) + from
      return { text: text.slice(0, from) + inner + text.slice(to), start: shift(start), end: shift(end) }
    }
  }
  let a = start
  let b = end
  if (a === b) {
    a = 0
    b = text.length
  }
  while (a < b && /\s/.test(text[a])) a++
  while (b > a && /\s/.test(text[b - 1])) b--
  if (a === b) return { text, start, end }
  // Words already highlighted inside the new range merge into it.
  const inner = plain(text.slice(a, b))
  const next = `${text.slice(0, a)}==${inner}==${text.slice(b)}`
  return { text: next, start: a + 2, end: a + 2 + inner.length }
}
