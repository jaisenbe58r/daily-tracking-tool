import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { inheritFromFilters, matches, parentPath } from '../lib/organize'
import type { Action } from '../lib/store'
import { DueLabel } from './DueLabel'
import { useToday } from '../lib/today'
import { flatten } from '../lib/tree'
import type { Filters, Inherit, Status, Task } from '../lib/types'

const COLUMNS: { status: Status; label: string }[] = [
  { status: 'todo', label: 'To do' },
  { status: 'doing', label: 'Doing' },
  { status: 'done', label: 'Done' },
]

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = (e: KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey)

interface Drag {
  id: string
  x: number
  y: number
  /** Pointer offset inside the card, so the ghost doesn't jump. */
  dx: number
  dy: number
  width: number
  over: Status | null
}

interface Props {
  tasks: Task[]
  dispatch: (action: Action) => void
  /** Done cards always show on the board; `hideDone` is a list-only setting. */
  filters: Filters
  onTagClick: (tag: string) => void
}

export function BoardView({ tasks, dispatch, filters, onTagClick }: Props) {
  const activeTag = filters.tag
  const today = useToday()
  const [drag, setDrag] = useState<Drag | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [focusCard, setFocusCard] = useState<{ id: string } | null>(null)
  const columnRefs = useRef<Partial<Record<Status, HTMLElement | null>>>({})

  // Cards follow the manual (tree) order; empty lines from the folio are left out.
  const cards = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]))
    const open = tasks.map((t) => (t.collapsed ? { ...t, collapsed: false } : t))
    return flatten(open)
      .map((r) => byId.get(r.task.id)!)
      .filter((t) => t.text.trim() && matches(t, { ...filters, hideDone: false }, today))
      .map((task) => {
        const kids = tasks.filter((t) => t.parentId === task.id)
        return { task, context: parentPath(byId, task), done: kids.filter((k) => k.status === 'done').length, total: kids.length }
      })
  }, [tasks, filters, today])

  // Keep keyboard focus on a card after it moves to another column.
  // Applied once per request, so later renders never pull focus away from where the user is typing.
  const appliedFocus = useRef<object | null>(null)
  useLayoutEffect(() => {
    if (!focusCard || appliedFocus.current === focusCard) return
    appliedFocus.current = focusCard
    document.querySelector<HTMLElement>(`[data-card-id="${focusCard.id}"]`)?.focus()
  }, [focusCard])

  const move = (task: Task, dir: -1 | 1) => {
    const i = COLUMNS.findIndex((c) => c.status === task.status)
    const target = COLUMNS[i + dir]
    if (!target) return
    dispatch({ type: 'set-status', id: task.id, status: target.status })
    setFocusCard({ id: task.id })
  }

  const onCardKey = (e: KeyboardEvent<HTMLElement>, task: Task) => {
    if (editing === task.id) return
    const cardsInDom = [...document.querySelectorAll<HTMLElement>(`[data-column="${task.status}"] [data-card-id]`)]
    const i = cardsInDom.findIndex((el) => el.dataset.cardId === task.id)
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      move(task, e.key === 'ArrowLeft' ? -1 : 1)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      cardsInDom[i + (e.key === 'ArrowUp' ? -1 : 1)]?.focus()
    } else if (e.key === 'Enter' && mod(e)) {
      e.preventDefault()
      dispatch({ type: 'toggle-done', id: task.id })
      setFocusCard({ id: task.id })
    } else if (e.altKey && e.code === 'KeyH') {
      e.preventDefault()
      dispatch({ type: 'toggle-today', id: task.id })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      setEditing(task.id)
    } else if (e.key === 'Backspace' && mod(e)) {
      e.preventDefault()
      ;(cardsInDom[i + 1] ?? cardsInDom[i - 1])?.focus()
      dispatch({ type: 'remove', id: task.id, focusPrev: false })
    }
  }

  // Mouse drags start after a few pixels. On touch a drag needs a short press
  // first, so a swipe over the cards still scrolls the page.
  const startDrag = (e: ReactPointerEvent<HTMLElement>, task: Task) => {
    if (e.button !== 0 || editing === task.id || (e.target as HTMLElement).closest('button')) return
    const touch = e.pointerType === 'touch'
    const rect = e.currentTarget.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY
    let armed = !touch
    let current: Drag | null = null
    let moved = false

    const columnAt = (x: number, y: number): Status | null => {
      for (const { status } of COLUMNS) {
        const r = columnRefs.current[status]?.getBoundingClientRect()
        if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return status
      }
      return null
    }

    const update = (x: number, y: number) => {
      current = { id: task.id, x, y, dx: startX - rect.left, dy: startY - rect.top, width: rect.width, over: columnAt(x, y) }
      setDrag(current)
    }

    const hold = touch
      ? window.setTimeout(() => {
          armed = true
          navigator.vibrate?.(8)
          update(startX, startY)
        }, 280)
      : 0

    const onMove = (ev: PointerEvent) => {
      const far = Math.hypot(ev.clientX - startX, ev.clientY - startY)
      if (!armed) {
        if (far > 8) {
          moved = true
          cleanup() // A scroll, not a drag.
        }
        return
      }
      if (!current && far < 4) return
      update(ev.clientX, ev.clientY)
    }

    // Once a touch drag is armed, stop the page from scrolling under it.
    const onTouchMove = (ev: TouchEvent) => {
      if (armed) ev.preventDefault()
    }

    const cleanup = () => {
      window.clearTimeout(hold)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('touchmove', onTouchMove)
      setDrag(null)
    }

    const onUp = () => {
      cleanup()
      const drop = current as Drag | null
      if (drop?.over && drop.over !== task.status) {
        dispatch({ type: 'set-status', id: task.id, status: drop.over })
      } else if (!drop && !moved) {
        setEditing(task.id) // A tap or click, not a drag: edit in place.
      }
    }

    const onCancel = () => cleanup()

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
  }

  const dragged = drag && cards.find((c) => c.task.id === drag.id)

  return (
    <div className="board" data-dragging={drag ? true : undefined}>
      {COLUMNS.map(({ status, label }) => {
        const column = cards.filter((c) => c.task.status === status)
        return (
          <section
            key={status}
            className="column"
            data-column={status}
            data-over={drag?.over === status || undefined}
            ref={(el) => {
              columnRefs.current[status] = el
            }}
          >
            <h2 className="column-head">
              <span className="column-dot" data-status={status} />
              <span>{label}</span>
              <span className="group-count">{column.length}</span>
            </h2>

            <div className="cards">
              {column.map(({ task, context, done, total }) => (
                <article
                  key={task.id}
                  className="card"
                  data-card-id={task.id}
                  data-status={task.status}
                  data-dragging={drag?.id === task.id || undefined}
                  tabIndex={0}
                  onPointerDown={(e) => startDrag(e, task)}
                  onKeyDown={(e) => onCardKey(e, task)}
                >
                  {context && <div className="card-context">{context}</div>}
                  <div className="card-line">
                    <button
                      className="check"
                      role="checkbox"
                      aria-checked={task.status === 'done' ? 'true' : task.status === 'doing' ? 'mixed' : 'false'}
                      aria-label={task.status === 'done' ? 'Reabrir' : 'Completar'}
                      tabIndex={-1}
                      onClick={() => dispatch({ type: 'toggle-done', id: task.id })}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                        <path d="M2 5.2l2 2L8 3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                      </svg>
                    </button>
                    {editing === task.id ? (
                      <CardEditor
                        task={task}
                        dispatch={dispatch}
                        onDone={() => {
                          setEditing(null)
                          setFocusCard({ id: task.id })
                        }}
                      />
                    ) : (
                      <p className="card-text">{task.text}</p>
                    )}
                  </div>
                  {(task.tags.length > 0 || total > 0 || task.due || task.priority) && (
                    <div className="card-meta">
                      {task.priority && <span className="prio" title="Prioridad">!</span>}
                      {task.due && <DueLabel due={task.due} done={task.status === 'done'} repeat={task.repeat} />}
                      {total > 0 && (
                        <span className="card-progress" title={`${done} de ${total} subtareas hechas`}>
                          {done}/{total}
                        </span>
                      )}
                      {task.tags.map((tag) => (
                        <button
                          key={tag}
                          className="tag"
                          data-active={tag === activeTag || undefined}
                          tabIndex={-1}
                          title={tag === activeTag ? 'Quitar filtro' : `Filtrar por #${tag}`}
                          onClick={() => onTagClick(tag)}
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>

            <AddCard status={status} label={label} inherit={inheritFromFilters(filters, today)} dispatch={dispatch} />
          </section>
        )
      })}

      {drag && dragged && (
        <article
          className="card card-ghost"
          style={{ width: drag.width, transform: `translate(${drag.x - drag.dx}px, ${drag.y - drag.dy}px) rotate(1.2deg)` }}
          aria-hidden
        >
          {dragged.context && <div className="card-context">{dragged.context}</div>}
          <p className="card-text">{dragged.task.text}</p>
        </article>
      )}
    </div>
  )
}

function CardEditor({ task, dispatch, onDone }: { task: Task; dispatch: (a: Action) => void; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [task.text])

  const finish = () => {
    dispatch({ type: 'commit', id: task.id })
    onDone()
  }

  return (
    <textarea
      ref={ref}
      className="card-text card-input"
      rows={1}
      value={task.text}
      onChange={(e) => dispatch({ type: 'edit', id: task.id, patch: { text: e.target.value } })}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finish()
        }
      }}
    />
  )
}

/** Quick capture at the foot of each column: type, Enter, keep typing. */
function AddCard({ status, label, inherit, dispatch }: { status: Status; label: string; inherit: Inherit; dispatch: (a: Action) => void }) {
  const [text, setText] = useState('')
  return (
    <input
      className="add-card"
      value={text}
      placeholder="+ Añadir"
      aria-label={`Añadir tarea en ${label}`}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && text.trim()) {
          e.preventDefault()
          dispatch({ type: 'create', text, status, inherit })
          setText('')
        } else if (e.key === 'Escape') {
          setText('')
          e.currentTarget.blur()
        }
      }}
    />
  )
}
