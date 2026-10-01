import { z } from 'zod'
import { parse } from 'partial-json'
import { TOOL_DESCRIPTIONS, type ToolName } from './prompt'
import { marksSchema, proposalSchema, selectionSchema, textSchema } from './schema'

/** The answers a request can end in, whichever way the model is reached. */
export const TOOLS = {
  propose_changes: { schema: proposalSchema, description: TOOL_DESCRIPTIONS.propose_changes },
  write_text: { schema: textSchema, description: TOOL_DESCRIPTIONS.write_text },
  select_tasks: { schema: selectionSchema, description: TOOL_DESCRIPTIONS.select_tasks },
  mark_phrases: { schema: marksSchema, description: TOOL_DESCRIPTIONS.mark_phrases },
} as const

export type ToolResult<T extends ToolName> = z.infer<(typeof TOOLS)[T]['schema']>

export interface Ask<T extends ToolName> {
  /** Which answer this request needs; the model is made to give exactly this one. */
  tool: T
  /** What the user typed, or the instruction built for them (/split, /plan). */
  request: string
  /** The sheet as the model sees it (see `snapshot`). */
  context: string
  /** Called with the answer's fields as they stream in, so the preview grows line by line. */
  onPartial?: (partial: Partial<ToolResult<T>>) => void
  signal?: AbortSignal
}

/** The tool's parameters as plain JSON Schema, for transports that don't speak zod. */
export function jsonSchema(tool: ToolName): Record<string, unknown> {
  const { $schema: _, ...schema } = z.toJSONSchema(TOOLS[tool].schema) as Record<string, unknown>
  return schema
}

export function validate<T extends ToolName>(tool: T, value: unknown): ToolResult<T> {
  const parsed = TOOLS[tool].schema.safeParse(value)
  if (!parsed.success) throw new Error('La IA no devolvió una respuesta válida')
  return parsed.data as ToolResult<T>
}

/** Whatever object half-written JSON already describes (a Markdown fence or a sentence before it is skipped). */
export function readPartial(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  const start = value.indexOf('{')
  if (start < 0) return null
  try {
    const parsed: unknown = parse(value.slice(start))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export const aborted = () => new DOMException('Cancelado', 'AbortError')
