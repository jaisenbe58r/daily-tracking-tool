import { dateKey, fold, resolveDate } from '../lib/parse'
import { address, type CalendarEvent } from './inbox/sources'

/**
 * «Nueva reunión»: when and with whom, worked out here (pure, tested): the
 * first free half hour in the next working days, who to invite, and what the
 * user types to change it ("el jueves a las 10", "1 hora").
 */

export interface Busy {
  start: number
  end: number
}

/** Office hours a meeting is proposed in. */
export const HOURS = { from: 9, to: 18 }
const STEP_MIN = 30

const at = (day: string, hour: number, minute = 0) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, hour, minute).getTime()
}

/** The next `n` working days (Monday to Friday) after `now`'s day. */
export function workingDays(now: Date, n: number): string[] {
  const out: string[] = []
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  while (out.length < n) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(dateKey(d))
  }
  return out
}

/** The time events take, as far as the user is concerned: not cancelled, declined, all-day or marked free. */
export function busyFrom(events: CalendarEvent[], me: Set<string>): Busy[] {
  const out: Busy[] = []
  for (const e of events) {
    if (e.status === 'cancelled' || e.transparency === 'transparent' || !e.start?.dateTime || !e.end?.dateTime) continue
    const self = e.attendees?.find((a) => a.self || me.has(address(a.email)))
    if (self?.responseStatus === 'declined') continue
    out.push({ start: Date.parse(e.start.dateTime), end: Date.parse(e.end.dateTime) })
  }
  return out
}

/**
 * The first start, on the half hour, in these days and office hours, where
 * `minutes` fit without touching anything busy and that isn't already past.
 * With `hour` (minutes after midnight), only that time is tried each day.
 */
export function freeSlot(busy: Busy[], days: string[], minutes: number, now: number, hour?: number): Date | null {
  const length = minutes * 60_000
  for (const day of days) {
    const first = hour ?? HOURS.from * 60
    const last = hour ?? HOURS.to * 60 - minutes
    for (let t = first; t <= last; t += STEP_MIN) {
      const start = at(day, 0, t)
      if (start < now) continue
      if (!busy.some((b) => b.start < start + length && b.end > start)) return new Date(start)
    }
  }
  return null
}

/** ISO with the local offset ("2026-10-02T10:00:00+02:00"), as Calendar takes it. */
export function isoLocal(d: Date): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  return `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${off >= 0 ? '+' : '-'}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`
}

export interface Adjust {
  day: string | null
  /** Minutes after midnight. */
  time: number | null
  minutes: number | null
}

const NUMBER: Record<string, number> = { una: 1, un: 1, dos: 2, tres: 3 }

/** What the user typed to move the proposal: a day (the sheet's own date grammar), a time, a length. */
export function parseAdjust(text: string, now: Date): Adjust {
  const t = fold(text)
  let day: string | null = null
  const words = t.split(/[\s,]+/).filter(Boolean)
  for (let i = 0; i < words.length && !day; i++) day = resolveDate(words.slice(i, i + 2).join(' '), now) ?? resolveDate(words[i], now)

  let minutes: number | null = null
  const hours = t.match(/\b(\d+|una|un|dos|tres)\s*(?:h\b|horas?)(\s*y\s*media)?/)
  if (/\bmedia hora\b/.test(t)) minutes = 30
  else if (hours) minutes = (NUMBER[hours[1]] ?? Number(hours[1])) * 60 + (hours[2] ? 30 : 0)
  else if (/\bhora y media\b/.test(t)) minutes = 90
  const mins = t.match(/\b(\d+)\s*min/)
  if (mins) minutes = Number(mins[1])

  let time: number | null = null
  const clock = t.match(/\ba las?\s+(\d{1,2})(?:[:.](\d{2}))?/) ?? t.match(/\b(\d{1,2})[:.](\d{2})\b/) ?? t.match(/\b(\d{1,2})\s*h\b(?!oras?)/)
  // "1 h" is a length, not one in the morning: a bare "Nh" counts as a time only from 7 on.
  if (clock && !(clock[0].endsWith('h') && Number(clock[1]) < 7)) {
    let h = Number(clock[1])
    // Nobody meets at four in the morning: "a las 4" is in the afternoon.
    if (h >= 1 && h <= 7) h += 12
    if (h <= 23) time = h * 60 + Number(clock[2] ?? 0)
    if (clock[0].endsWith('h') && minutes === Number(clock[1]) * 60) minutes = null
  }
  return { day, time, minutes: minutes && minutes > 0 && minutes <= 8 * 60 ? minutes : null }
}

/** `@ana` in a task, not a date ("@lunes" plans it). */
export function mentions(text: string, now = new Date()): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/(^|\s)@([\p{L}][\p{L}\p{N}_.-]*)/gu)) if (!resolveDate(m[2], now)) out.push(m[2].replace(/[.]+$/, ''))
  return [...new Set(out)]
}

/** Plain addresses written in a text. */
export const emailsIn = (text: string) => [...new Set((text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []).map((a) => a.toLowerCase()))]

/**
 * Who to invite: known addresses, plus the `@names` that match one of them
 * (by a word of its name part: @ana → ana.garcia@cliente.es). Names with no
 * address stay as names, for the event's description.
 */
export function invitees(names: string[], known: string[], me: Set<string>): { emails: string[]; names: string[] } {
  const emails = [...new Set(known.map(address))].filter((a) => a.includes('@') && !me.has(a))
  const left: string[] = []
  for (const n of names) {
    const key = fold(n)
    const hit = emails.find((a) => fold(a.split('@')[0]).split(/[._-]+/).includes(key))
    if (!hit) left.push(n)
  }
  return { emails, names: left }
}

/** The model's answer: the title on the first line, the agenda below. */
export function readPlan(text: string, fallback: string): { title: string; agenda: string[] } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  // No title, straight to the agenda: the task's text is the title.
  if (/^[-*•]\s/.test(lines[0] ?? '')) lines.unshift(fallback)
  const title = (lines[0] ?? '').replace(/^(#+\s*|t[ií]tulo:\s*)/i, '').replace(/^[«"*]+|[»"*]+$/g, '').trim()
  const agenda = lines.slice(1).map((l) => (l.startsWith('- ') ? l : `- ${l.replace(/^[-*•]\s*/, '')}`)).slice(0, 5)
  return { title: (title || fallback).slice(0, 80), agenda }
}
