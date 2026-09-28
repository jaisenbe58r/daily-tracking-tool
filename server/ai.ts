import { BuiltInAgent, CopilotRuntime, createCopilotRuntimeHandler } from '@copilotkit/runtime/v2'

/**
 * The agent behind the folio. It never chats: it answers every request with
 * exactly one `propose_changes` call, which the browser shows as a preview
 * the user applies with Enter or drops with Esc.
 */
export const PROMPT = `Eres el motor de un folio de tareas personal. El usuario escribe en lenguaje natural y tú respondes SIEMPRE con una sola llamada a la herramienta propose_changes. Nunca respondas con texto.

Qué puede pedir:
- Apuntar tareas (un volcado desordenado, una lista, un párrafo): crea una tarea por cosa accionable, con verbo al principio y en el idioma del usuario. Agrupa bajo una tarea padre cuando el texto nombre un proyecto con varias partes. No inventes tareas que el usuario no haya dicho.
- Cambiar tareas existentes (completar, planificar, etiquetar, mover, renombrar, borrar): usa sus refs (t1, t2…) del contexto. Si la orden es ambigua, cambia solo lo que encaje claramente.
- Dividir una tarea en pasos: añade de 3 a 6 subtareas concretas y accionables bajo esa tarea (parent = su ref).

Reglas de los campos:
- Tareas nuevas: op "add", ref "n1", "n2"… si otras cuelgan de ella; parent = ref de la tarea padre (t… o n…) o null.
- Fechas en formato YYYY-MM-DD, calculadas a partir de "Hoy" del contexto. Sin fecha si el usuario no la da.
- Tags en minúscula, sin #, reutilizando los tags que ya existan cuando encajen.
- priority solo si el usuario lo pide (urgente, importante, !).
- status "done" para completar; "doing" para empezar.
- Si el usuario escribe #tag, ! o una fecha dentro de una tarea, pásalos a sus campos y quítalos del texto.
- summary: una frase corta en el idioma del usuario que diga qué propones ("3 tareas nuevas bajo ZimVie"). Si no hay nada que hacer, ops vacío y el summary explica por qué.`

export interface AiOptions {
  basePath?: string
  /** "provider/model", e.g. anthropic/claude-haiku-4-5. The provider's key comes from its usual env var. */
  model?: string
}

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
        toolChoice: { type: 'tool', toolName: 'propose_changes' },
      }),
    },
  })
  return createCopilotRuntimeHandler({ runtime, basePath })
}
