import { z } from 'zod'
import type { Proposal } from './ops'

/**
 * The `propose_changes` tool's parameters. One flat op shape (instead of a
 * union per op) keeps the schema small and easy for the model to fill.
 * Lives apart from ops.ts so zod only loads with the AI client.
 */
export const proposalSchema = z.object({
  summary: z.string().describe('Una frase corta para el usuario, en su idioma'),
  ops: z.array(
    z.object({
      op: z.enum(['add', 'update', 'move', 'remove']),
      id: z.string().optional().describe('Tarea existente (t3) para update, move o remove'),
      ref: z.string().optional().describe('Nombre de una tarea nueva (n1) para colgar otras de ella'),
      parent: z.string().nullable().optional().describe('Padre para add o move: t…, n… o null'),
      text: z.string().optional(),
      notes: z.string().optional(),
      tags: z.array(z.string()).optional(),
      due: z.string().nullable().optional().describe('YYYY-MM-DD, o null para quitar la fecha'),
      priority: z.boolean().optional(),
      status: z.enum(['todo', 'doing', 'done']).optional(),
    }),
  ),
}) satisfies z.ZodType<Proposal>

