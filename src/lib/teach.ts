import { createContext, useCallback, useContext, useMemo } from 'react'

/**
 * Shortcuts that teach themselves: when something with a key is done with
 * the mouse or from the "/" menu, a short notice names the key. Only the
 * first few times per action; after that it stays quiet for good.
 */

const KEY = 'daily-tracking-tool:taught'
const TIMES = 3

/** Hints in the "/" menu that are grammar or labels, not keys to press. */
const NOT_KEYS = new Set(['!', '#', 'IA', '↻'])
export const isShortcut = (hint: string | undefined): hint is string => !!hint && !NOT_KEYS.has(hint)

function read(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

/** Whether to show the hint for `action` now; counts the showing. */
export function shouldTeach(action: string): boolean {
  const counts = read()
  const seen = counts[action] ?? 0
  if (seen >= TIMES) return false
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...counts, [action]: seen + 1 }))
  } catch {
    // Storage blocked: the hint may repeat a few more times, nothing worse.
  }
  return true
}

interface Notice {
  /** Short message in the notice at the bottom. */
  notify: (text: string) => void
  /** Names the key for `action`, the first few times only. */
  teach: (action: string, keys: string) => void
}

export const NoticeContext = createContext<Notice>({ notify: () => {}, teach: () => {} })

export const useNotice = () => useContext(NoticeContext)

export function useNoticeValue(notify: (text: string) => void): Notice {
  const teach = useCallback(
    (action: string, keys: string) => {
      // On a phone or tablet there's no keyboard to teach.
      if (typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches) return
      if (shouldTeach(action)) notify(`La próxima vez: ${keys}`)
    },
    [notify],
  )
  return useMemo(() => ({ notify, teach }), [notify, teach])
}
