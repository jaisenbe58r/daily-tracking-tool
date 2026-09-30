import type { ToolName } from './prompt'
import { PROMPT, userTurn } from './prompt'
import { NeedsKey, apiKey } from './config'
import { TOOLS, aborted, jsonSchema, readPartial, validate, type Ask, type ToolResult } from './tools'

/**
 * No server: the browser calls Anthropic itself with the user's own key,
 * kept in this browser only. Same forced tool call as the server agent,
 * streamed so the preview grows as the arguments arrive.
 */
const MODEL: string = import.meta.env.VITE_AI_MODEL || 'claude-haiku-4-5'

export async function ask<T extends ToolName>({ tool, request, context, onPartial, signal }: Ask<T>): Promise<ToolResult<T>> {
  const key = apiKey.get()
  if (!key) throw new NeedsKey()
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // Anthropic's opt-in for calls straight from a page: the key is the user's own, in their own browser.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        temperature: 0,
        stream: true,
        system: PROMPT,
        tools: [{ name: tool, description: TOOLS[tool].description, input_schema: jsonSchema(tool) }],
        tool_choice: { type: 'tool', name: tool },
        messages: [{ role: 'user', content: userTurn(context, request) }],
      }),
    })
  } catch (error) {
    if (signal?.aborted) throw aborted()
    throw error instanceof TypeError ? new Error('No se pudo conectar con Anthropic') : error
  }
  if (res.status === 401 || res.status === 403) {
    apiKey.clear()
    throw new NeedsKey(true)
  }
  if (res.status === 429 || res.status === 529) throw new Error('Anthropic está saturado. Reintenta en un momento')
  if (!res.ok || !res.body) throw new Error(`Anthropic respondió ${res.status}`)

  let args = ''
  let buffer = ''
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += value
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        let event: { type: string; delta?: { type: string; partial_json?: string }; error?: { message?: string } }
        try {
          event = JSON.parse(line.slice(5))
        } catch {
          throw new Error('La respuesta de la IA llegó cortada. Vuelve a pedirlo')
        }
        if (event.type === 'error') throw new Error(event.error?.message ?? 'Anthropic falló')
        if (event.delta?.type !== 'input_json_delta' || !event.delta.partial_json) continue
        args += event.delta.partial_json
        const partial = onPartial && readPartial(args)
        if (partial) onPartial(partial as Partial<ToolResult<T>>)
      }
    }
  } catch (error) {
    if (signal?.aborted) throw aborted()
    throw error
  }
  let value: unknown = null
  try {
    value = JSON.parse(args || 'null')
  } catch {
    /* validate says so */
  }
  return validate(tool, value)
}
