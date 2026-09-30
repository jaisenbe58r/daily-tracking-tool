import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Action } from '../lib/store'
import type { Repeat, Task } from '../lib/types'
import { useToday } from '../lib/today'
import { dueLabel } from '../lib/parse'
import { isSnoozed, resolveSnooze, snoozeChoices } from '../lib/snooze'
import { isShortcut, useNotice } from '../lib/teach'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const M = isMac ? '⌘' : 'Ctrl '
const A = isMac ? '⌥' : 'Alt+'

const dayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
/** "jue 1 oct", always the date (the label already says "Mañana"). */
const shortDate = (day: string) => dayFmt.format(new Date(`${day}T12:00`)).replace(/\./g, '').replace(',', '')

const REPEATS: { repeat: Repeat; label: string }[] = [
  { repeat: 'daily', label: 'cada día' },
  { repeat: 'weekdays', label: 'entre semana' },
  { repeat: 'weekly', label: 'cada semana' },
  { repeat: 'monthly', label: 'cada mes' },
]

export interface QuickItem {
  label: string
  hint?: string
  keywords?: string
  run: () => void
  /** Only listed once the user types something that matches (rare or destructive actions). */
  searchOnly?: boolean
  /** Keeps the menu open (it switches to a second list, like the dates for Posponer). */
  stay?: boolean
}

/** Second lists: the day to postpone to, plain or waiting on someone. */
export type SubMenu = 'snooze' | 'wait'
type Item = QuickItem

interface Props {
  task: Task
  hasChildren: boolean
  anchor: DOMRect
  dispatch: (action: Action) => void
  /** App-wide actions (templates, summary, backup…) listed after the task's own. */
  extra: QuickItem[]
  onClose: (refocus: boolean) => void
  /** Open straight on a second list (Alt+L opens the dates for Posponer). */
  initialSub?: SubMenu | null
}

export function QuickActions({ task, hasChildren, anchor, dispatch, extra, onClose, initialSub = null }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [sub, setSub] = useState<SubMenu | null>(initialSub)
  const inputRef = useRef<HTMLInputElement>(null)
  const id = task.id
  const today = useToday()
  const { notify, teach } = useNotice()
  const away = isSnoozed(task, today)

  const openSub = useCallback((next: SubMenu | null) => {
    setSub(next)
    setQuery('')
    setActive(0)
  }, [])

  const items = useMemo<Item[]>(() => {
    const focusText = (caret: 'end' | 'start' = 'end') => dispatch({ type: 'focus', id, caret })
    const list: Item[] = [
      {
        label: task.status === 'done' ? 'Reabrir' : 'Completar',
        hint: `${M}↵`,
        keywords: 'hecho done check terminar',
        run: () => { dispatch({ type: 'toggle-done', id }); focusText() },
      },
      {
        label: task.status === 'doing' ? 'Quitar de en curso' : 'En curso',
        keywords: 'doing progreso empezar',
        run: () => { dispatch({ type: 'set-status', id, status: task.status === 'doing' ? 'todo' : 'doing' }); focusText() },
      },
      {
        label: task.due === today ? 'Quitar de hoy' : 'Para hoy',
        hint: `${A}H`,
        keywords: 'hoy fecha today planificar',
        run: () => { dispatch({ type: 'toggle-today', id }); focusText() },
      },
      ...(away
        ? [{ label: 'Quitar posponer', hint: `${A}L`, keywords: 'posponer snooze volver recordar', run: () => { dispatch({ type: 'unsnooze', id }); focusText() } }]
        : [
            { label: 'Posponer…', hint: `${A}L`, keywords: 'posponer snooze luego recordar ocultar', stay: true, run: () => openSub('snooze') },
            { label: 'Esperando…', keywords: 'esperando respuesta seguimiento perseguir follow', stay: true, run: () => openSub('wait') },
          ]),
      {
        label: task.priority ? 'Quitar prioridad' : 'Prioridad',
        hint: '!',
        keywords: 'importante urgente prioridad',
        run: () => { dispatch({ type: 'toggle-priority', id }); focusText() },
      },
      {
        label: 'Nota',
        hint: '⇧↵',
        keywords: 'notas comentario',
        run: () => dispatch({ type: 'focus', id, target: 'notes' }),
      },
      {
        label: 'Tag',
        hint: '#',
        keywords: 'etiqueta label',
        run: () => {
          const text = task.text.trimEnd()
          dispatch({ type: 'edit', id, patch: { text: text ? `${text} #` : '#' } })
          focusText()
        },
      },
      ...(task.repeat
        ? [{ label: 'Quitar repetición', hint: '↻', keywords: 'repetir recurrente', run: () => { dispatch({ type: 'set-repeat', id, repeat: null }); focusText() } }]
        : REPEATS.map(({ repeat, label }) => ({
            label: `Repetir ${label}`,
            keywords: 'repetir recurrente rutina',
            searchOnly: true,
            run: () => { dispatch({ type: 'set-repeat', id, repeat }); focusText() },
          }))),
      { label: 'Subtarea', keywords: 'hija child nueva', run: () => dispatch({ type: 'add-child', id }) },
      { label: 'Indentar', hint: 'Tab', keywords: 'subtarea nivel', run: () => dispatch({ type: 'indent', id }) },
      { label: 'Subir nivel', hint: '⇧Tab', keywords: 'outdent desindentar', run: () => dispatch({ type: 'outdent', id }) },
      { label: 'Mover arriba', hint: '⌥⇧↑', keywords: 'reordenar', run: () => dispatch({ type: 'move-up', id }) },
      { label: 'Mover abajo', hint: '⌥⇧↓', keywords: 'reordenar', run: () => dispatch({ type: 'move-down', id }) },
    ]
    if (hasChildren) {
      list.push({
        label: task.collapsed ? 'Expandir' : 'Colapsar',
        hint: `${M}.`,
        keywords: 'plegar desplegar hijos',
        run: () => { dispatch({ type: 'toggle-collapse', id }); focusText() },
      })
    }
    list.push({ label: 'Eliminar', keywords: 'borrar delete', run: () => dispatch({ type: 'remove', id }) })
    return [...list, ...extra]
  }, [dispatch, id, task.status, task.text, task.collapsed, task.due, task.priority, task.repeat, away, today, hasChildren, extra, openSub])

  // Dates for Posponer / Esperando: the usual picks, or whatever date the user types.
  const subItems = useMemo<Item[]>(() => {
    if (!sub) return []
    const now = new Date(`${today}T12:00`)
    const postpone = (until: string) => () => {
      // The row is about to disappear: keep the cursor on the row above (or below).
      const rows = [...document.querySelectorAll<HTMLElement>('[data-row-id]')].map((el) => el.dataset.rowId!)
      const at = rows.indexOf(id)
      const neighbour = rows[at - 1] ?? rows[at + 1]
      dispatch({ type: 'snooze', id, until, waiting: sub === 'wait' })
      if (neighbour) dispatch({ type: 'focus', id: neighbour })
      notify(`${sub === 'wait' ? 'Esperando' : 'Pospuesta'} hasta ${dueLabel(until, now).toLowerCase()} · ${isMac ? '⌘' : 'Ctrl+'}Z deshace`)
    }
    const typed = query.trim() ? resolveSnooze(query, now) : null
    const choices = snoozeChoices(now, sub === 'wait')
    const q = query.trim().toLowerCase()
    return [
      ...(typed ? [{ label: `Hasta ${dueLabel(typed, now).toLowerCase()}`, run: postpone(typed) }] : []),
      ...choices
        .filter((c) => !q || typed || c.label.toLowerCase().includes(q))
        .filter((c) => c.until !== typed)
        .map((c) => ({ label: c.label, hint: shortDate(c.until), run: postpone(c.until) })),
    ]
  }, [sub, query, today, id, dispatch, notify])

  const q = query.trim().toLowerCase()
  const filtered = sub
    ? subItems
    : q
      ? items.filter((i) => `${i.label} ${i.keywords ?? ''}`.toLowerCase().includes(q))
      : items.filter((i) => !i.searchOnly)
  const current = Math.min(active, Math.max(filtered.length - 1, 0))

  // On open, and again when switching to the dates (a click may have taken focus away).
  useLayoutEffect(() => inputRef.current?.focus(), [sub])

  const run = (item: Item | undefined) => {
    if (!item) return
    // Chosen from the menu: name its key, the first few times.
    if (!sub && isShortcut(item.hint)) teach(item.label, item.hint)
    if (!item.stay) onClose(false)
    item.run()
  }

  const top = Math.min(anchor.bottom + 6, window.innerHeight - 340)
  const left = Math.min(anchor.left, window.innerWidth - 256)

  return (
    <div className="qa-backdrop" onPointerDown={() => onClose(true)}>
      <div className="qa" style={{ top, left }} onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label={sub ? (sub === 'wait' ? 'Esperando hasta' : 'Posponer hasta') : 'Acciones rápidas'}>
        {sub && <div className="qa-title">{sub === 'wait' ? 'Esperando respuesta hasta' : 'Posponer hasta'}</div>}
        <input
          ref={inputRef}
          className="qa-input"
          value={query}
          placeholder={sub ? 'lunes, 15/10, 3 días…' : 'Acción…'}
          onChange={(e) => { setQuery(e.target.value); setActive(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((current + 1) % Math.max(filtered.length, 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((current - 1 + filtered.length) % Math.max(filtered.length, 1)) }
            else if (e.key === 'Enter') { e.preventDefault(); run(filtered[current]) }
            else if ((e.key === 'Escape' || (e.key === 'Backspace' && !query)) && sub && !initialSub) { e.preventDefault(); openSub(null) }
            else if (e.key === 'Escape' || (e.key === 'Backspace' && !query)) { e.preventDefault(); onClose(true) }
          }}
        />
        <ul className="qa-list" role="listbox">
          {filtered.map((item, i) => (
            <li
              key={item.label}
              role="option"
              aria-selected={i === current}
              className="qa-item"
              onPointerEnter={() => setActive(i)}
              onClick={() => run(item)}
            >
              <span>{item.label}</span>
              {item.hint && <kbd>{item.hint}</kbd>}
            </li>
          ))}
          {!filtered.length && <li className="qa-empty">{sub ? 'Escribe un día: lunes, 15/10, 3 días…' : 'Sin resultados'}</li>}
        </ul>
      </div>
    </div>
  )
}
