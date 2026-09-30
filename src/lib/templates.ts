import { useCallback, useEffect, useState } from 'react'

/** A reusable task tree, stored as the indented text that pasting understands. */
export interface Template {
  name: string
  outline: string
}

const KEY = 'daily-tracking-tool:templates'

export function sanitizeTemplates(input: unknown): Template[] {
  if (!Array.isArray(input)) return []
  return input.filter(
    (t): t is Template => !!t && typeof t === 'object' && typeof t.name === 'string' && typeof t.outline === 'string' && t.name.trim() !== '',
  )
}

function load(): Template[] {
  try {
    return sanitizeTemplates(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
  } catch {
    return []
  }
}

export function useTemplates() {
  const [templates, setTemplates] = useState(load)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(templates))
    } catch {
      // Storage full or blocked: templates last for this visit only.
    }
  }, [templates])

  /** Saving under an existing name replaces that template. */
  const save = useCallback((t: Template) => setTemplates((all) => [...all.filter((x) => x.name !== t.name), t]), [])
  const remove = useCallback((name: string) => setTemplates((all) => all.filter((x) => x.name !== name)), [])
  return { templates, save, remove, replaceAll: setTemplates }
}
