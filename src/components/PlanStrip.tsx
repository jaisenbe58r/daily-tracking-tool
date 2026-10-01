import { currentIndex, type PlanStep } from '../lib/plan'

const A = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥' : 'Alt+'

const STATE: Record<PlanStep['state'], string> = { done: 'Hecho', now: 'Ahora', next: 'Después' }

interface Props {
  steps: PlanStep[]
  /** Clicking a step: take the cursor to that task. Absent in the preview. */
  onPick?: (id: string) => void
  /** × or Esc: drop the plan. Absent in the preview. */
  onClear?: () => void
}

/**
 * Plan del día as a short workflow, 1 → 2 → 3: done steps carry the green
 * check, «Ahora» is the first one still open, the rest come after. The hairline
 * between steps fills in ink up to «Ahora». Wide: a row; narrow: a column.
 */
export function PlanStrip({ steps, onPick, onClear }: Props) {
  if (!steps.length) return null
  const at = currentIndex(steps)
  const preview = !onPick
  return (
    <section
      className="plan"
      aria-label="Plan del día"
      data-preview={preview || undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onClear) {
          e.preventDefault()
          onClear()
        }
      }}
    >
      <ol className="plan-steps">
        {steps.map((step, i) => {
          const body = (
            <>
              <span className="plan-head">
                <span className="plan-mark" aria-hidden>
                  {step.state === 'done' ? (
                    <svg width="10" height="10" viewBox="0 0 10 10">
                      <path d="M2 5.2l2 2L8 3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="plan-state">{STATE[step.state]}</span>
              </span>
              <span className="plan-text">{step.task.text.trim()}</span>
              {step.project && <span className="plan-project">{step.project}</span>}
              {step.why && <span className="plan-why">{step.why}</span>}
            </>
          )
          return (
            <li key={step.task.id} className="plan-step" data-state={step.state} data-passed={i < at || undefined}>
              {onPick ? (
                <button
                  type="button"
                  className="plan-card"
                  aria-current={step.state === 'now' ? 'step' : undefined}
                  title={step.state === 'now' ? `Ir a la tarea (${A}J)` : 'Ir a la tarea'}
                  onClick={() => onPick(step.task.id)}
                >
                  {body}
                </button>
              ) : (
                <div className="plan-card">{body}</div>
              )}
            </li>
          )
        })}
      </ol>
      {onClear && (
        <button type="button" className="plan-clear" aria-label="Quitar el plan del día" title="Quitar el plan (Esc)" onClick={onClear}>
          ×
        </button>
      )}
    </section>
  )
}
