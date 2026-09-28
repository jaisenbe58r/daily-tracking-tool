import { memo, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Action, Focus } from '../lib/store'
import type { Group, Row } from '../lib/types'

interface Props {
  row: Row
  focus: Focus | null
  dragging: boolean
  dispatch: (action: Action) => void
  onOpenActions: (id: string, anchor: HTMLElement) => void
  onDragStart: (id: string, e: PointerEvent) => void
  /** False in grouped views, where the tree can't be edited (no Tab, no dragging). */
  structural: boolean
  /** Attributes a task created from this row inherits (its group, the active tag filter). */
  inherit: Group['inherit']
  activeTag: string | null
  onTagClick: (tag: string) => void
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = (e: KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey)

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' })
const fullDateFmt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'full', timeStyle: 'short' })

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = '0px'
  el.style.height = `${el.scrollHeight}px`
}

function isSingleLine(el: HTMLTextAreaElement) {
  return el.scrollHeight <= parseFloat(getComputedStyle(el).lineHeight) * 1.5
}

function TaskRowImpl({ row, focus, dragging, dispatch, onOpenActions, onDragStart, structural, inherit, activeTag, onTagClick }: Props) {
  const { task, depth, hasChildren, lastPath, context, dimmed } = row
  const textRef = useRef<HTMLTextAreaElement>(null)
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const appliedSeq = useRef(0)
  const showNotes = notesOpen || task.notes.length > 0
  const focused = focus?.id === task.id ? focus : null

  useLayoutEffect(() => autosize(textRef.current), [task.text])
  useLayoutEffect(() => autosize(notesRef.current), [task.notes, showNotes])

  // Apply focus requests coming from the store (new task, indent, arrows...).
  useLayoutEffect(() => {
    if (!focused || appliedSeq.current === focused.seq) return
    if (focused.target === 'notes' && !notesRef.current) {
      // The notes field isn't rendered yet: open it and come back on the next render.
      setNotesOpen(true)
      return
    }
    const el = focused.target === 'notes' ? notesRef.current : textRef.current
    if (!el) return
    // Synchronous on purpose: keys typed right after Enter/Tab must land after the caret.
    appliedSeq.current = focused.seq
    el.focus()
    const len = el.value.length
    const pos = focused.caret === 'end' ? len : focused.caret === 'start' ? 0 : Math.min(focused.caret, len)
    el.setSelectionRange(pos, pos)
  }, [focused, notesOpen])

  const onTextKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    const el = e.currentTarget
    const caret = el.selectionStart
    const collapsedSel = el.selectionStart === el.selectionEnd

    if (e.key === 'Enter' && mod(e)) {
      e.preventDefault()
      dispatch({ type: 'toggle-done', id: task.id })
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      dispatch({ type: 'commit', id: task.id })
      dispatch({ type: 'focus', id: task.id, target: 'notes' })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (structural && !task.text.trim() && depth > 0) {
        dispatch({ type: 'outdent', id: task.id })
      } else {
        dispatch({ type: 'commit', id: task.id })
        dispatch({ type: 'add-after', id: task.id, inherit, flat: !structural })
      }
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (structural) dispatch({ type: e.shiftKey ? 'outdent' : 'indent', id: task.id, caret })
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.altKey || mod(e)) && e.shiftKey) {
      e.preventDefault()
      if (structural) dispatch({ type: e.key === 'ArrowUp' ? 'move-up' : 'move-down', id: task.id, caret })
    } else if (e.key === '.' && mod(e)) {
      e.preventDefault()
      dispatch({ type: 'toggle-collapse', id: task.id })
    } else if (e.key === 'ArrowUp' && collapsedSel && (caret === 0 || isSingleLine(el))) {
      e.preventDefault()
      focusSibling(el, -1, caret)
    } else if (e.key === 'ArrowDown' && collapsedSel && (caret === el.value.length || isSingleLine(el))) {
      e.preventDefault()
      focusSibling(el, 1, caret)
    } else if (e.key === 'Backspace' && !task.text && collapsedSel) {
      e.preventDefault()
      dispatch({ type: 'remove', id: task.id })
    } else if (e.key === '/' && collapsedSel && (caret === 0 || /\s/.test(el.value[caret - 1]))) {
      e.preventDefault()
      onOpenActions(task.id, el)
    } else if (e.key === 'Escape') {
      el.blur()
    }
  }

  // Arrow navigation walks the rendered rows, so it follows the visible tree.
  const focusSibling = (el: HTMLElement, dir: 1 | -1, caret: number) => {
    const inputs = [...document.querySelectorAll<HTMLTextAreaElement>('textarea[data-task-text]')]
    const target = inputs[inputs.indexOf(el as HTMLTextAreaElement) + dir]
    const id = target?.dataset.taskText
    if (id) dispatch({ type: 'focus', id, caret })
  }

  const onNotesKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && e.shiftKey) || (e.key === 'Enter' && mod(e))) {
      e.preventDefault()
      dispatch({ type: 'focus', id: task.id, target: 'text' })
    }
  }

  const statusLabel = task.status === 'done' ? 'Hecha' : task.status === 'doing' ? 'En curso' : 'Pendiente'

  return (
    <div
      className="row"
      data-row-id={task.id}
      data-status={task.status}
      data-dragging={dragging || undefined}
      data-dimmed={dimmed || undefined}
      style={{ '--depth': depth } as React.CSSProperties}
    >
      {structural && (
        <button
          className="handle"
          aria-label="Arrastrar para reordenar"
          tabIndex={-1}
          onPointerDown={(e) => onDragStart(task.id, e)}
        >
          <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden>
            {[2, 7, 12].flatMap((y) => [<circle key={`a${y}`} cx="2" cy={y} r="1" />, <circle key={`b${y}`} cx="6" cy={y} r="1" />])}
          </svg>
        </button>
      )}

      {lastPath.map((last, i) => (
        <span
          key={i}
          className="guide"
          data-kind={i === lastPath.length - 1 ? (last ? 'end' : 'tee') : last ? 'none' : 'pipe'}
          aria-hidden
        />
      ))}

      <button
        className="chevron"
        data-visible={hasChildren || undefined}
        data-collapsed={task.collapsed || undefined}
        tabIndex={-1}
        aria-label={task.collapsed ? 'Expandir' : 'Colapsar'}
        onClick={() => dispatch({ type: 'toggle-collapse', id: task.id })}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M3 2l3.5 3L3 8" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>

      <button
        className="check"
        role="checkbox"
        aria-checked={task.status === 'done' ? 'true' : task.status === 'doing' ? 'mixed' : 'false'}
        aria-label={statusLabel}
        title={statusLabel}
        tabIndex={-1}
        onClick={() => dispatch({ type: 'toggle-done', id: task.id })}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 5.2l2 2L8 3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>

      <div className="body">
        <div className="line">
          <textarea
            ref={textRef}
            className="text"
            data-task-text={task.id}
            rows={1}
            value={task.text}
            placeholder={depth === 0 ? 'Escribe una tarea…' : 'Subtarea…'}
            spellCheck={false}
            onChange={(e) => dispatch({ type: 'edit', id: task.id, patch: { text: e.target.value } })}
            onKeyDown={onTextKey}
            onBlur={() => dispatch({ type: 'commit', id: task.id })}
          />
          {context && <span className="context" title={context}>{context}</span>}
          {task.tags.length > 0 && (
            <span className="tags">
              {task.tags.map((tag) => (
                <span key={tag} className="tag" data-active={tag === activeTag || undefined}>
                  <button tabIndex={-1} title={tag === activeTag ? 'Quitar filtro' : `Filtrar por #${tag}`} onClick={() => onTagClick(tag)}>
                    #{tag}
                  </button>
                  <button
                    className="tag-remove"
                    tabIndex={-1}
                    aria-label={`Quitar #${tag} de la tarea`}
                    title="Quitar tag"
                    onClick={() => dispatch({ type: 'edit', id: task.id, patch: { tags: task.tags.filter((t) => t !== tag) } })}
                  >
                    ×
                  </button>
                </span>
              ))}
            </span>
          )}
          {!showNotes && (
            <button className="note-toggle" tabIndex={-1} title="Añadir nota (⇧↵)" onClick={() => dispatch({ type: 'focus', id: task.id, target: 'notes' })}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M2 3h8M2 6h8M2 9h5" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            </button>
          )}
          <time className="date" dateTime={new Date(task.createdAt).toISOString()} title={`Creada el ${fullDateFmt.format(task.createdAt)}`}>
            {dateFmt.format(task.createdAt).replace('.', '')}
          </time>
        </div>
        {showNotes && (
          <textarea
            ref={notesRef}
            className="notes"
            rows={1}
            value={task.notes}
            placeholder="Nota…"
            onChange={(e) => dispatch({ type: 'edit', id: task.id, patch: { notes: e.target.value } })}
            onKeyDown={onNotesKey}
            onBlur={() => setNotesOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

export const TaskRow = memo(TaskRowImpl)
