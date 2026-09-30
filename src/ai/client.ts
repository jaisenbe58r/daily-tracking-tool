import type { AiMode } from './config'
import type { ToolName } from './prompt'
import type { Ask, ToolResult } from './tools'

/**
 * One way to ask, whichever way the AI is reached here (see `probeAi`).
 * Each way loads on first use, so the folio pays nothing for the others.
 */
const load = {
  server: () => import('./copilot'),
  claude: () => import('./claude'),
  key: () => import('./direct'),
} satisfies Record<AiMode, () => Promise<{ ask: (a: Ask<ToolName>) => Promise<unknown> }>>

export async function ask<T extends ToolName>(mode: AiMode, request: Ask<T>): Promise<ToolResult<T>> {
  const { ask: run } = await load[mode]()
  return run(request as Ask<ToolName>) as Promise<ToolResult<T>>
}
