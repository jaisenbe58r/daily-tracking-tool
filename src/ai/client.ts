import { CopilotKitCore, CopilotKitCoreRuntimeConnectionStatus } from '@copilotkit/core'
import { AI_URL } from './config'
import type { Proposal } from './ops'
import { proposalSchema } from './schema'

/**
 * The browser half of the agent, on CopilotKit's framework-agnostic core: no
 * chat UI, no conversation. Each request is one fresh run that must end in a
 * `propose_changes` tool call; the call's arguments are the proposal.
 * Loaded on first use so the folio pays nothing for it until then.
 */
let core: CopilotKitCore | null = null
let received: Proposal | null = null

function getCore(): CopilotKitCore {
  if (core) return core
  core = new CopilotKitCore({ runtimeUrl: AI_URL })
  core.addTool({
    name: 'propose_changes',
    description:
      'Propone cambios en el folio. El usuario ve la propuesta y la aplica o la descarta. Llámala una sola vez con todas las operaciones.',
    parameters: proposalSchema,
    followUp: false,
    handler: async (args) => {
      received = args as Proposal
      return 'Propuesta mostrada al usuario.'
    },
  })
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

export interface Ask {
  /** What the user typed, or the instruction built for them (/split). */
  request: string
  /** The sheet as the agent sees it (see `snapshot`). */
  context: string
  signal?: AbortSignal
}

export async function ask({ request, context, signal }: Ask): Promise<Proposal> {
  const ck = getCore()
  await connected(ck)
  const agent = ck.getAgent('default')
  if (!agent) throw new Error('La IA no está configurada')

  received = null
  const contextId = ck.addContext({ description: 'El folio del usuario ahora mismo', value: context })
  const stop = () => ck.stopAgent({ agent })
  signal?.addEventListener('abort', stop)
  try {
    agent.threadId = crypto.randomUUID()
    agent.setMessages([{ id: crypto.randomUUID(), role: 'user', content: request }])
    await ck.runAgent({ agent })
  } finally {
    signal?.removeEventListener('abort', stop)
    ck.removeContext(contextId)
  }
  if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
  const proposal = proposalSchema.safeParse(received)
  if (!proposal.success) throw new Error('La IA no devolvió una propuesta válida')
  return proposal.data
}
