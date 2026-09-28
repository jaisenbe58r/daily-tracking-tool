import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Action } from '../lib/store'
import type { Task } from '../lib/types'
import { useToday } from '../lib/today'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const M = isMac ? '⌘' : 'Ctrl '
const A = isMac ? '⌥' : 'Alt '

export interface QuickItem {
  label: string
  hint?: string
  keywords?: string
  run: () => void
  /** Only listed once the user types something that matches (rare or destructive actions). */
  searchOnly?: boolean
}
type Item = QuickItem

interface Props {
  task: Task
  hasChildren: boolean
  anchor: DOMRect
  dispatch: (action: Action) => void
  /** App-wide actions (templates, summary, backup…) listed after the task's own. */
  extra: QuickItem[]
  onClose: (refocus: boolean) => void
}

export function QuickActions({ task, hasChildren, anchor, dispatch, extra, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const id = task.id
  const today = useToday()

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
  }, [dispatch, id, task.status, task.text, task.collapsed, task.due, task.priority, today, hasChildren, extra])

  const q = query.trim().toLowerCase()
  const filtered = q ? items.filter((i) => `${i.label} ${i.keywords ?? ''}`.toLowerCase().includes(q)) : items.filter((i) => !i.searchOnly)
  const current = Math.min(active, Math.max(filtered.length - 1, 0))

  useLayoutEffect(() => inputRef.current?.focus(), [])

  const run = (item: Item | undefined) => {
    if (!item) return
    onClose(false)
    item.run()
  }

  const top = Math.min(anchor.bottom + 6, window.innerHeight - 340)
  const left = Math.min(anchor.left, window.innerWidth - 256)

  return (
    <div className="qa-backdrop" onPointerDown={() => onClose(true)}>
      <div className="qa" style={{ top, left }} onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Acciones rápidas">
        <input
          ref={inputRef}
          className="qa-input"
          value={query}
          placeholder="Acción…"
          onChange={(e) => { setQuery(e.target.value); setActive(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((current + 1) % Math.max(filtered.length, 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((current - 1 + filtered.length) % Math.max(filtered.length, 1)) }
            else if (e.key === 'Enter') { e.preventDefault(); run(filtered[current]) }
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
          {!filtered.length && <li className="qa-empty">Sin resultados</li>}
        </ul>
      </div>
    </div>
  )
}
