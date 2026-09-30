import { BuiltInAgent, CopilotRuntime, createCopilotRuntimeHandler } from '@copilotkit/runtime/v2'
import { PROMPT } from '../src/ai/prompt.ts'

export interface AiOptions {
  basePath?: string
  /** "provider/model", e.g. anthropic/claude-haiku-4-5. The provider's key comes from its usual env var. */
  model?: string
}

/**
 * The agent behind the folio. It never chats: every request is forced (by the
 * browser, per request) to end in exactly one tool call, and the browser
 * shows that call as a preview the user applies, copies or drops.
 */
export function createAiHandler({ basePath = '/api/ai', model = process.env.AI_MODEL ?? 'anthropic/claude-haiku-4-5' }: AiOptions = {}) {
  // A personal sheet: nothing about it is reported to CopilotKit unless asked for.
  process.env.COPILOTKIT_TELEMETRY_DISABLED ??= 'true'
  const runtime = new CopilotRuntime({
    agents: {
      default: new BuiltInAgent({
        model,
        prompt: PROMPT,
        maxSteps: 1,
        temperature: 0,
        // The browser names the one tool each request must answer with; nothing else is overridable.
        toolChoice: 'required',
        overridableProperties: ['toolChoice'],
      }),
    },
  })
  return createCopilotRuntimeHandler({ runtime, basePath })
}
