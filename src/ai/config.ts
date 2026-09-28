/** Where the AI runtime lives. Same origin by default (the Vite plugin, or a function deployed at /api/ai). */
export const AI_URL: string = import.meta.env.VITE_AI_URL || '/api/ai'

/**
 * Cheap check, without loading CopilotKit: is there a runtime with an agent?
 * The AI actions stay hidden until this says yes.
 */
export async function probeAi(): Promise<boolean> {
  try {
    const res = await fetch(`${AI_URL}/info`, { headers: { accept: 'application/json' } })
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return false
    const info = (await res.json()) as { agents?: Record<string, unknown> }
    return Boolean(info.agents && Object.keys(info.agents).length)
  } catch {
    return false
  }
}
