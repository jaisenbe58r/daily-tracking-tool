import type { ToolName } from './prompt'
import { PROMPT, userTurn } from './prompt'
import { claudeHost } from './config'
import { TOOLS, aborted, jsonSchema, readPartial, validate, type Ask, type ToolResult } from './tools'

/**
 * Inside claude.ai the app can't reach any server, but the page may ask
 * Claude itself, on the viewer's own account: no key, and claude.ai asks
 * the viewer once before the first request. There are no forced tool calls
 * here, so the model answers with the tool's arguments as bare JSON, which
 * streams into the preview the same way.
 */
interface Sample {
  json(
    input: string,
    options: { onText?: (u: { text: string }) => void; signal?: AbortSignal; modelTier?: 'quick' | 'default' | 'complex' },
  ): Promise<unknown>
}
interface SampleError {
  code?: string
}

const MESSAGES: Record<string, string> = {
  not_granted: 'Claude necesita tu permiso para usar la IA en esta página',
  rate_limited: 'Demasiadas peticiones seguidas. Espera un poco y reintenta',
  quota_exceeded: 'Has agotado tu uso de Claude por ahora',
  invalid_json: 'La IA no devolvió una respuesta válida',
}

let sample: Promise<Sample | null> | null = null

export async function ask<T extends ToolName>({ tool, request, context, onPartial, signal }: Ask<T>): Promise<ToolResult<T>> {
  sample ??= claudeHost()?.use('sample').then((s) => (s as Sample) ?? null, () => null) ?? Promise.resolve(null)
  const claude = await sample
  if (!claude) throw new Error('Claude no está disponible en esta página')
  const input = [
    PROMPT,
    `Aquí no hay llamadas a herramientas: responde SOLO con los argumentos de ${tool} como un objeto JSON, sin texto alrededor. ${TOOLS[tool].description}`,
    `JSON Schema de ${tool}:\n${JSON.stringify(jsonSchema(tool))}`,
    userTurn(context, request),
  ].join('\n\n')
  try {
    const value = await claude.json(input, {
      signal,
      // The quick model starts writing at once; the others think silently for seconds first.
      modelTier: 'quick',
      onText: onPartial
        ? ({ text }) => {
            const partial = readPartial(text)
            if (partial) onPartial(partial as Partial<ToolResult<T>>)
          }
        : undefined,
    })
    return validate(tool, value)
  } catch (error) {
    if (signal?.aborted) throw aborted()
    const code = (error as SampleError)?.code
    throw code ? new Error(MESSAGES[code] ?? 'Claude no pudo responder') : error
  }
}
