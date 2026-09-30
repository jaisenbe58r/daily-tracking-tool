import { CopilotKitCore, CopilotKitCoreRuntimeConnectionStatus } from '@copilotkit/core'
import type { z } from 'zod'
import { AI_URL } from './config'
import { proposalSchema, selectionSchema, textSchema } from './schema'

/**
 * The browser half of the agent, on CopilotKit's framework-agnostic core: no
 * chat UI, no conversation. Each request is one fresh run forced to end in
 * one tool call; that call's arguments are the answer. Loaded on first use so
 * the folio pays nothing for it until then.
 */
const TOOLS = {
  propose_changes: {
    schema: proposalSchema,
    description:
      'Propone cambios en el folio. El usuario ve la propuesta y la aplica o la descarta. Llámala una sola vez con todas las operaciones.',
  },
  write_text: {
    schema: textSchema,
    description: 'Devuelve un texto redactado para el usuario (un resumen), que verá y copiará tal cual.',
  },
  select_tasks: {
    schema: selectionSchema,
    description: 'Devuelve las tareas que responden a una búsqueda por significado.',
  },
} as const

export type ToolName = keyof typeof TOOLS
export type ToolResult<T extends ToolName> = z.infer<(typeof TOOLS)[T]['schema']>

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

/** AG-UI hands partial arguments as an object or, depending on the agent, as JSON text already closed off. */
function readPartial(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export interface Ask<T extends ToolName> {
  /** Which answer this request needs; the run is forced to call exactly this tool. */
  tool: T
  /** What the user typed, or the instruction built for them (/split, /plan). */
  request: string
  /** The sheet as the agent sees it (see `snapshot`). */
  context: string
  /** Called with the tool's arguments as they stream in, so the preview grows line by line. */
  onPartial?: (partial: Partial<ToolResult<T>>) => void
  signal?: AbortSignal
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
  if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
  const call = last.call as { tool: ToolName; args: unknown } | null
  const parsed = TOOLS[tool].schema.safeParse(call?.tool === tool ? call.args : null)
  if (!parsed.success) throw new Error('La IA no devolvió una respuesta válida')
  return parsed.data as ToolResult<T>
}
