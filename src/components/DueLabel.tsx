import { dueLabel } from '../lib/parse'
import { repeatLabel } from '../lib/repeat'
import { useToday } from '../lib/today'
import type { Repeat } from '../lib/types'

/** "Hoy", "Mañana", "vie 3 oct". Overdue open tasks are set solid so they can't be missed. A ↻ marks a recurring task. */
export function DueLabel({ due, done, repeat = null }: { due: string; done: boolean; repeat?: Repeat | null }) {
  const today = useToday()
  const when = due < today ? 'overdue' : due === today ? 'today' : 'later'
  const title = [when === 'overdue' && !done ? 'Vencida' : 'Planificada', repeat && repeatLabel(repeat, due).toLowerCase()].filter(Boolean).join(' · ')
  return (
    <span className="due" data-when={done ? 'later' : when} title={title}>
      {repeat && <span className="repeat" aria-label={repeatLabel(repeat, due)}>↻</span>}
      {dueLabel(due, new Date(`${today}T12:00`))}
    </span>
  )
}
