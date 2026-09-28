import { useEffect, useState } from 'react'
import type { Filters, SortMode } from './types'

export type View = 'list' | 'board'

export interface Prefs {
  view: View
  sort: SortMode
  filters: Filters
}

const KEY = 'daily-tracking-tool:prefs'
const DEFAULTS: Prefs = { view: 'list', sort: 'manual', filters: { tag: null, hideDone: false } }

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      view: raw.view === 'board' ? 'board' : 'list',
      sort: ['manual', 'date', 'status', 'tag'].includes(raw.sort) ? raw.sort : 'manual',
      filters: {
        tag: typeof raw.filters?.tag === 'string' ? raw.filters.tag : null,
        hideDone: raw.filters?.hideDone === true,
      },
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
