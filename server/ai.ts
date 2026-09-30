import { BuiltInAgent, CopilotRuntime, createCopilotRuntimeHandler } from '@copilotkit/runtime/v2'

/**
 * The agent behind the folio. It never chats: every request is forced (by the
 * browser, per request) to end in exactly one tool call, and the browser
 * shows that call as a preview the user applies, copies or drops.
 */
export const PROMPT = `Eres el motor de un folio de tareas personal. Respondes SIEMPRE con una sola llamada a la herramienta que se te pide. Nunca respondas con texto fuera de ella. Escribe en el idioma del usuario.

propose_changes: cambios en el folio.
- Apuntar tareas (un volcado desordenado, una lista, un párrafo, un dictado): una tarea por cosa accionable, con verbo al principio. Agrupa bajo una tarea padre cuando el texto nombre un proyecto con varias partes. No inventes tareas que el usuario no haya dicho.
- Cambiar tareas existentes (completar, planificar, etiquetar, mover, renombrar, borrar): usa sus refs (t1, t2…) del contexto. Si la orden es ambigua, cambia solo lo que encaje claramente.
- Dividir una tarea en pasos: de 3 a 6 subtareas concretas y accionables bajo esa tarea (parent = su ref).
- Planificar el día: como máximo 3 tareas abiertas, las que más importan hoy (vencidas, arrastradas varios días, en curso o prioritarias); a cada una due = hoy y priority = true. No cambies nada más.
- Tareas nuevas: op "add", ref "n1", "n2"… si otras cuelgan de ella; parent = ref del padre (t… o n…) o null.
- Fechas YYYY-MM-DD calculadas desde "Hoy" del contexto; sin fecha si el usuario no la da. Tags en minúscula, sin #, reutilizando los que ya existan. priority solo si el usuario lo pide o al planificar. status "done" completa, "doing" empieza.
- Si el usuario escribe #tag, ! o una fecha dentro de una tarea, pásalos a sus campos y quítalos del texto.
- summary: una frase corta que diga qué propones ("3 tareas nuevas bajo ZimVie"). Si no hay nada que hacer, ops vacío y el summary explica por qué.

write_text: un texto para el usuario, listo para pegar. Para el resumen del día: lo cerrado hoy, lo que sigue en curso y lo que queda para mañana, en frases cortas y agrupado por proyecto cuando lo haya. Solo hechos del contexto; nada inventado, sin saludos ni cierre.

select_tasks: búsqueda por significado. Devuelve las refs de las tareas que responden a la búsqueda aunque no compartan palabras (sinónimos, el proyecto al que pertenecen, lo que implican), de más a menos relevante. Si nada encaja, lista vacía.`

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
        // The browser names the one tool each request must answer with; nothing else is overridable.
        toolChoice: 'required',
        overridableProperties: ['toolChoice'],
      }),
    },
  })
  return createCopilotRuntimeHandler({ runtime, basePath })
}
