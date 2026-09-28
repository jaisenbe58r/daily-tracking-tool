/**
 * Quick-capture grammar, applied when a line is committed (Enter or blur):
 *
 *   "Llamar a IT mañana #zimvie !"  →  text "Llamar a IT", due tomorrow, tag zimvie, priority
 *
 * - `#tag` anywhere.
 * - `!` as its own word marks priority.
 * - A date at the end of the line ("hoy", "mañana", "pasado mañana", a weekday,
 *   "3/10"), or anywhere with an `@` ("@viernes"). Only the end of the line is
 *   read without `@`, so "informe de mañana para Ana" stays as written.
 */

export interface Parsed {
  text: string
  tags: string[]
  priority: boolean
  /** Local date as YYYY-MM-DD. */
  due: string | null
}

const TAG_RE = /(^|\s)#([\p{L}\p{N}_-]+)/gu
const BANG_RE = /(^|\s)!{1,3}(?=\s|$)/g

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

export const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

/** Resolves one date phrase, or null when it isn't one. */
export function resolveDate(phrase: string, now: Date): string | null {
  const p = fold(phrase.trim())
  if (p === 'hoy') return dateKey(now)
  if (p === 'manana') return dateKey(addDays(now, 1))
  if (p === 'pasado manana' || p === 'pasado') return dateKey(addDays(now, 2))
  const weekday = WEEKDAYS.indexOf(p)
  if (weekday >= 0) {
    // The next one to come; saying today's weekday means next week ("hoy" is for today).
    const ahead = (weekday - now.getDay() + 7) % 7 || 7
    return dateKey(addDays(now, ahead))
  }
  const m = p.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/)
  if (m) {
    const day = Number(m[1])
    const month = Number(m[2]) - 1
    let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : now.getFullYear()
    let d = new Date(year, month, day)
    if (d.getMonth() !== month || d.getDate() !== day) return null
    // "3/1" typed in December means next January.
    if (!m[3] && dateKey(d) < dateKey(now)) d = new Date(++year, month, day)
    return dateKey(d)
  }
  return null
}

export function parseTask(input: string, now = new Date()): Parsed {
  const tags: string[] = []
  let text = input.replace(TAG_RE, (_, lead: string, tag: string) => {
    tags.push(tag.toLowerCase())
    return lead
  })

  let priority = false
  text = text.replace(BANG_RE, (_, lead: string) => {
    priority = true
    return lead
  })

  let due: string | null = null
  text = text.replace(/(^|\s)@(pasado\s+ma[nñ]ana|\S+)/giu, (all, lead: string, phrase: string) => {
    const date = resolveDate(phrase, now)
    if (!date) return all
    due = date
    return lead
  })

  if (!due) {
    // Trailing phrase: try the last two words, then the last one. Never eat the whole line.
    const words = text.trim().split(/\s+/)
    for (const n of [2, 1]) {
      if (words.length <= n) continue
      const date = resolveDate(words.slice(-n).join(' '), now)
      if (date) {
        due = date
        text = words.slice(0, -n).join(' ')
        break
      }
    }
  }

  return { text: text.replace(/\s{2,}/g, ' ').trim(), tags: [...new Set(tags)], priority, due }
}

const dueFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })

/** "Hoy", "Mañana", "Ayer" or "vie 3 oct". */
export function dueLabel(due: string, now = new Date()): string {
  if (due === dateKey(now)) return 'Hoy'
  if (due === dateKey(addDays(now, 1))) return 'Mañana'
  if (due === dateKey(addDays(now, -1))) return 'Ayer'
  const [y, m, d] = due.split('-').map(Number)
  return dueFmt.format(new Date(y, m - 1, d)).replace(/\./g, '').replace(',', '')
}

export interface OutlineItem {
  text: string
  depth: number
  done: boolean
}

const TREE_PREFIX = /^[\s│├└─┬┼|]*/
const BULLET = /^(?:[-*•·‣◦▪]|\d+[.)])\s+/
const CHECKBOX = /^(?:\[( |x|X)\]|[☐☑✓✔])\s*/

/**
 * Pasted text as an outline: one task per line, nesting from indentation
 * (spaces, tabs or tree-drawing characters like "├─"), bullets and
 * checkboxes stripped, "[x]" / "☑" marking a line as done.
 */
export function parseOutline(raw: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const indents: number[] = []
  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) continue
    const prefix = line.match(TREE_PREFIX)![0]
    const indent = prefix.replace(/\t/g, '    ').length
    let text = line.slice(prefix.length).replace(BULLET, '')
    const box = text.match(CHECKBOX)
    const done = !!box && (box[0].startsWith('☑') || box[0].startsWith('✓') || box[0].startsWith('✔') || /x/i.test(box[1] ?? ''))
    if (box) text = text.slice(box[0].length)
    while (indents.length && indents[indents.length - 1] >= indent) indents.pop()
    items.push({ text: text.trim(), depth: indents.length, done })
    indents.push(indent)
  }
  return items.filter((i) => i.text)
}
