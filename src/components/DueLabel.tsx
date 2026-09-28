import { dueLabel } from '../lib/parse'
import { useToday } from '../lib/today'

/** "Hoy", "Mañana", "vie 3 oct". Overdue open tasks are set solid so they can't be missed. */
export function DueLabel({ due, done }: { due: string; done: boolean }) {
  const today = useToday()
  const when = due < today ? 'overdue' : due === today ? 'today' : 'later'
  return (
    <span className="due" data-when={done ? 'later' : when} title={when === 'overdue' && !done ? 'Vencida' : 'Planificada'}>
      {dueLabel(due, new Date(`${today}T12:00`))}
    </span>
  )
}
