import { CopilotKitCore, CopilotKitCoreRuntimeConnectionStatus } from '@copilotkit/core'
import type { ToolName } from './prompt'
import { AI_URL } from './config'
import { TOOLS, aborted, readPartial, validate, type Ask, type ToolResult } from './tools'

/**
 * The browser half of the server agent, on CopilotKit's framework-agnostic
 * core: no chat UI, no conversation. Each request is one fresh run forced to
 * end in one tool call; that call's arguments are the answer.
 */
let core: CopilotKitCore | null = null
/** The last tool call of the current run (an object, so TypeScript sees handler writes). */
const last: { call: { tool: ToolName; args: unknown } | null } = { call: null }

function getCore(): CopilotKitCore {
  if (core) return core
  core = new CopilotKitCore({ runtimeUrl: AI_URL })
  for (const [name, tool] of Object.entries(TOOLS)) {
    core.addTool({
      name,
      description: tool.description,
      // Each tool validates its own shape; core only needs a Standard Schema.
      parameters: tool.schema as never,
      followUp: false,
      handler: async (args) => {
        last.call = { tool: name as ToolName, args }
        return 'Mostrado al usuario.'
      },
    })
  }
  return core
}

function connected(ck: CopilotKitCore, timeoutMs = 8000): Promise<void> {
  if (ck.runtimeConnectionStatus === CopilotKitCoreRuntimeConnectionStatus.Connected) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('La IA no responde')), timeoutMs)
    const sub = ck.subscribe({
      onRuntimeConnectionStatusChanged: ({ status }) => {
        if (status === CopilotKitCoreRuntimeConnectionStatus.Connected) done()
        else if (status === CopilotKitCoreRuntimeConnectionStatus.Error) done(new Error('No se pudo conectar con la IA'))
      },
    })
    function done(error?: Error) {
      clearTimeout(timer)
      sub.unsubscribe()
      if (error) reject(error)
      else resolve()
    }
  })
}

export async function ask<T extends ToolName>({ tool, request, context, onPartial, signal }: Ask<T>): Promise<ToolResult<T>> {
  const ck = getCore()
  await connected(ck)
  const agent = ck.getAgent('default')
  if (!agent) throw new Error('La IA no está configurada')

  last.call = null
  const contextId = ck.addContext({ description: 'El folio del usuario ahora mismo', value: context })
  const stop = () => ck.stopAgent({ agent })
  signal?.addEventListener('abort', stop)
  const stream = onPartial
    ? agent.subscribe({
        onToolCallArgsEvent: ({ toolCallName, partialToolCallArgs }) => {
          if (toolCallName !== tool || signal?.aborted) return
          // AG-UI hands partial arguments as an object or, depending on the agent, as JSON text.
          const partial = readPartial(partialToolCallArgs)
          if (partial) onPartial(partial as Partial<ToolResult<T>>)
        },
      })
    : null
  try {
    agent.threadId = crypto.randomUUID()
    agent.setMessages([{ id: crypto.randomUUID(), role: 'user', content: request }])
    await ck.runAgent({ agent, forwardedProps: { toolChoice: { type: 'tool', toolName: tool } } })
  } finally {
    stream?.unsubscribe()
    signal?.removeEventListener('abort', stop)
    ck.removeContext(contextId)
  }
  if (signal?.aborted) throw aborted()
  const call = last.call as { tool: ToolName; args: unknown } | null
  return validate(tool, call?.tool === tool ? call.args : null)
}
