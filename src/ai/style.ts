import { QUOTE_START, address, type GmailMessage } from './inbox/sources'

/**
 * The user's way of writing, read from a few mails they sent: the signature
 * they end with (verbatim) and short examples of greeting, tone and length.
 * Read once a week and kept in this browser, so drafts don't fetch it each time.
 */

export interface Style {
  /** The user's address, the sender of their sent mail. */
  me: string | null
  /** The closing lines their mails share, verbatim; '' when they don't share any. */
  signature: string
  /** A few of their own mails, without quotes or signature, trimmed. */
  examples: string[]
  at: number
}

const KEY = 'daily-tracking-tool:estilo'
const WEEK = 7 * 86_400_000
const EXAMPLES = 3
const EXAMPLE_LIMIT = 450
const SIGNATURE_LINES = 10

/** What the user wrote in a mail: the quoted history below goes. Trailing blank lines too. */
export function ownPart(text: string): string[] {
  const lines: string[] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (QUOTE_START.test(line.trim())) break
    if (line.trim().startsWith('>')) continue
    lines.push(line.trimEnd())
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  return lines
}

/**
 * The closing lines most of these mails end with: the longest run of last lines
 * that at least two of them share (more mails sharing it wins a tie). '' when none.
 */
export function signatureOf(bodies: string[]): string {
  const counts = new Map<string, { n: number; k: number }>()
  for (const body of bodies) {
    const lines = ownPart(body)
    const seen = new Set<string>()
    for (let k = 1; k <= Math.min(SIGNATURE_LINES, lines.length - 1); k++) {
      const key = lines.slice(-k).map((l) => l.trim()).join('\n')
      if (seen.has(key)) continue
      seen.add(key)
      const c = counts.get(key) ?? { n: 0, k }
      c.n++
      counts.set(key, c)
    }
  }
  let best = ''
  let score = { n: 0, k: 0 }
  for (const [key, c] of counts) {
    if (c.n < 2) continue
    if (c.k > score.k || (c.k === score.k && c.n > score.n)) {
      best = key
      score = c
    }
  }
  // A signature starts on a line with words, not on the blank line above it.
  return best.replace(/^\s*\n/, '').trim()
}

/** The body without its signature (when it ends with it). */
export function withoutSignature(body: string, signature: string): string {
  const lines = ownPart(body)
  const sig = signature ? signature.split('\n') : []
  const tail = lines.slice(-sig.length).map((l) => l.trim())
  const out = sig.length && tail.join('\n') === sig.join('\n') ? lines.slice(0, -sig.length) : lines
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** The body ending with the signature, once: added only when the body doesn't carry it already. */
export function withSignature(body: string, signature: string): string {
  const text = body.trim()
  if (!signature.trim() || squash(text).includes(squash(signature))) return text
  return `${text}\n\n${signature.trim()}`
}

/** The user's own sent mails (newest first) as a style. */
export function styleFrom(sent: GmailMessage[], now = Date.now()): Style {
  const bodies = sent.map((m) => m.plaintextBody ?? '').filter((b) => b.trim())
  const signature = signatureOf(bodies)
  const examples = bodies
    .map((b) => withoutSignature(b, signature))
    .filter((b) => b.length > 20)
    .slice(0, EXAMPLES)
    .map((b) => (b.length > EXAMPLE_LIMIT ? `${b.slice(0, EXAMPLE_LIMIT)}…` : b))
  const me = sent.find((m) => m.sender)?.sender
  return { me: me ? address(me) : null, signature, examples, at: now }
}

/** How the draft prompt reads it. '' when there is nothing to imitate. */
export function describeStyle(style: Style | null): string {
  if (!style || (!style.signature && !style.examples.length)) return ''
  return [
    style.examples.length
      ? `Así escribo yo (correos que he enviado; imita el saludo, el tono, la longitud y la despedida, no su contenido):\n${style.examples.map((e) => `— ${e}`).join('\n\n')}`
      : '',
    style.signature ? `Mi firma, que va al final tal cual (no la repitas si ya está):\n${style.signature}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function load(): Style | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Style | null
    return raw && typeof raw.at === 'number' && Array.isArray(raw.examples) ? raw : null
  } catch {
    return null
  }
}

let reading: Promise<Style | null> | null = null

/** The kept style, read again from the sent mail when it's a week old. Null where Gmail can't be read. */
export function writingStyle(): Promise<Style | null> {
  const kept = load()
  if (kept && Date.now() - kept.at < WEEK) return Promise.resolve(kept)
  reading ??= (async () => {
    const { sentMessages } = await import('./inbox/connectors')
    const sent = await sentMessages().catch(() => null)
    if (!sent?.length) return kept
    const style = styleFrom(sent)
    try {
      localStorage.setItem(KEY, JSON.stringify(style))
    } catch {
      /* private mode: read again next visit */
    }
    return style
  })().finally(() => {
    reading = null
  })
  return reading
}
