import { useEffect, useState } from 'react'
import type { Filters, SortMode } from './types'

export type View = 'list' | 'board'

export interface Prefs {
  view: View
  sort: SortMode
  filters: Filters
  /** Last day the app was opened, to raise unfinished tasks once per new day. */
  lastDay: string | null
}

const KEY = 'daily-tracking-tool:prefs'
const DEFAULTS: Prefs = { view: 'list', sort: 'manual', filters: { tag: null, hideDone: false, today: false, query: '' }, lastDay: null }

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      view: raw.view === 'board' ? 'board' : 'list',
      sort: ['manual', 'date', 'status', 'tag'].includes(raw.sort) ? raw.sort : 'manual',
      filters: {
        tag: typeof raw.filters?.tag === 'string' ? raw.filters.tag : null,
        hideDone: raw.filters?.hideDone === true,
        today: raw.filters?.today === true,
        query: '',
      },
      lastDay: typeof raw.lastDay === 'string' ? raw.lastDay : null,
    }
  } catch {
    return DEFAULTS
  }
}

/** View settings are per device, kept apart from the tasks. */
export function usePrefs() {
  const [prefs, setPrefs] = useState(load)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
      // Not critical: the view just resets next time.
    }
  }, [prefs])
  return [prefs, setPrefs] as const
}
