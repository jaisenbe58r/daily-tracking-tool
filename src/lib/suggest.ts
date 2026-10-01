import type { Task } from './types'
import { fold, resolveDate } from './parse'

/**
 * Autocomplete for the capture line: `#` offers the tags already in use and
 * `@` the people already mentioned plus the date words, most used first.
 */

export interface Token {
  kind: '#' | '@'
  /** Where the `#` or `@` sits. */
  start: number
  /** What's typed after it. */
  prefix: string
}

/** The `#word` or `@word` the caret is at the end of, if any. */
export function tokenAt(text: string, caret: number): Token | null {
  const m = /(^|[\s(])([#@])([\p{L}\p{N}_/-]*)$/u.exec(text.slice(0, caret))
  if (!m) return null
  // Only while the word is being typed: a caret in the middle of one doesn't count.
  if (/[\p{L}\p{N}_-]/u.test(text[caret] ?? '')) return null
  return { kind: m[2] as Token['kind'], start: m.index + m[1].length, prefix: m[3] }
}

const MENTION_RE = /(^|[\s(])@([\p{L}\p{N}_-]+)/gu

/** People written as `@name` across the sheet, most mentioned first (dates left out). */
export function peopleIn(tasks: Pick<Task, 'text' | 'notes'>[], now = new Date()): string[] {
  const count = new Map<string, number>()
  for (const t of tasks) {
    for (const m of `${t.text}\n${t.notes}`.matchAll(MENTION_RE)) {
      const name = m[2].toLowerCase()
      if (resolveDate(name, now) || /^\d/.test(name)) continue
      count.set(name, (count.get(name) ?? 0) + 1)
    }
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n)
}

export const DATE_WORDS = ['hoy', 'mañana', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/** Up to `limit` matches: words that start with the prefix, then ones that contain it. */
export function suggestions(token: Token, pool: { tags: string[]; people: string[] }, limit = 6): string[] {
  const words = token.kind === '#' ? pool.tags : [...pool.people, ...DATE_WORDS]
  const q = fold(token.prefix)
  const starts = words.filter((w) => fold(w).startsWith(q))
  const within = q ? words.filter((w) => !fold(w).startsWith(q) && fold(w).includes(q)) : []
  return [...starts, ...within].filter((w) => fold(w) !== q).slice(0, limit)
}

/** The text with the token replaced by the chosen word and a space; returns it and the new caret. */
export function complete(text: string, token: Token, caret: number, word: string): { text: string; caret: number } {
  const before = `${text.slice(0, token.start)}${token.kind}${word} `
  const after = text.slice(caret).replace(/^ /, '')
  return { text: before + after, caret: before.length }
}
