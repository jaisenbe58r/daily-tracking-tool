/**
 * How the AI is reached, in order of preference:
 * - server: a CopilotKit runtime at AI_URL (the Vite plugin, or a function deployed at /api/ai) holds the key.
 * - claude: the page runs inside claude.ai, which lends it the viewer's own Claude; no key at all.
 * - key: anywhere else, the user's own Anthropic key, kept in this browser and sent straight to Anthropic.
 * This file stays tiny: it's in the main bundle, the rest loads on first use.
 */
export type AiMode = 'server' | 'claude' | 'key'

/** Where the AI runtime lives. Same origin by default. */
export const AI_URL: string = import.meta.env.VITE_AI_URL || '/api/ai'

interface ClaudeHost {
  use(name: string): Promise<unknown>
}
/** claude.ai's page API, present only when the app runs as an artifact there. */
export const claudeHost = (): ClaudeHost | null =>
  (typeof window !== 'undefined' && (window as unknown as { claude?: ClaudeHost }).claude) || null

async function hasServer(): Promise<boolean> {
  try {
    const res = await fetch(`${AI_URL}/info`, { headers: { accept: 'application/json' } })
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return false
    const info = (await res.json()) as { agents?: Record<string, unknown> }
    return Boolean(info.agents && Object.keys(info.agents).length)
  } catch {
    return false
  }
}

/** Which way the AI is reachable here, or null when it isn't (inside claude.ai without Claude). */
export async function probeAi(): Promise<AiMode | null> {
  const host = claudeHost()
  // Inside claude.ai the network is closed: neither a runtime nor Anthropic can be reached, only Claude.
  if (host) return (await host.use('sample').catch(() => null)) ? 'claude' : null
  return (await hasServer()) ? 'server' : 'key'
}

const KEY = 'daily-tracking-tool:anthropic-key'

export const apiKey = {
  get(): string | null {
    try {
      return localStorage.getItem(KEY)
    } catch {
      return null
    }
  },
  set(value: string) {
    try {
      localStorage.setItem(KEY, value.trim())
    } catch {
      /* private mode: the key lasts until the page closes */
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* nothing stored */
    }
  },
}

/** A request that can't go out until the user gives a key (or a better one). */
export class NeedsKey extends Error {
  readonly invalid: boolean
  constructor(invalid = false) {
    super(invalid ? 'Anthropic no acepta esa clave' : 'Falta la clave de Anthropic')
    this.name = 'NeedsKey'
    this.invalid = invalid
  }
}
