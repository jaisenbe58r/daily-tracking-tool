import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Action, Focus } from '../lib/store'
import type { Group, Row, Source } from '../lib/types'
import { DueLabel } from './DueLabel'
import { ageInDays, isStale } from '../lib/daily'
import { useToday } from '../lib/today'
import { daysAway, daysWaiting, isBack, isSnoozed, WAITING_TAG } from '../lib/snooze'
import { dueLabel } from '../lib/parse'
import { useNotice } from '../lib/teach'
import { useHasDraft } from '../ai/drafts'
import { hasMark, segments, toggleMark } from '../lib/mark'

const SOURCE_APP: Record<Source['app'], string> = { gmail: 'Gmail', calendar: 'Google Calendar', granola: 'Granola' }
const SOURCE_LABEL: Record<Source['app'], string> = { gmail: 'Gmail', calendar: 'Agenda', granola: 'Granola' }

interface Props {
  row: Row
  focus: Focus | null
  dragging: boolean
  dispatch: (action: Action) => void
  onOpenActions: (id: string, anchor: HTMLElement, sub?: 'snooze' | 'wait' | null) => void
  onDragStart: (id: string, e: PointerEvent) => void
  /** False in grouped views, where the tree can't be edited (no Tab, no dragging). */
  structural: boolean
  /** Attributes a task created from this row inherits (its group, the active tag filter). */
  inherit: Group['inherit']
  activeTag: string | null
  faded: boolean
  onTagClick: (tag: string) => void
  /** Part of a row selection (Shift+↑/↓, Shift+click). */
  selected: boolean
  /** Shift+↑/↓ past the text's edge (or Ctrl+A twice): start selecting rows. */
  onSelectRows: (id: string, dir: -1 | 1 | 'all') => void
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = (e: KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey)
const M = isMac ? '⌘' : 'Ctrl+'
/** A real mouse or touch click (keyboard "clicks" report no detail). */
const byPointer = (e: React.MouseEvent) => e.detail > 0

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

function TaskRowImpl({ row, focus, dragging, dispatch, onOpenActions, onDragStart, structural, inherit, activeTag, onTagClick, faded, selected, onSelectRows }: Props) {
  const today = useToday()
  const { teach } = useNotice()
  const drafted = useHasDraft(row.task.id)
  const stale = isStale(row.task, today)
  const { task, depth, hasChildren, lastPath, context, dimmed } = row
  const textRef = useRef<HTMLTextAreaElement>(null)
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const appliedSeq = useRef(0)
  const showNotes = notesOpen || task.notes.length > 0
  const focused = focus?.id === task.id ? focus : null

  useLayoutEffect(() => autosize(textRef.current), [task.text])
  // The width changes without the text changing (tags added, the window resized): fit the height again.
  useEffect(() => {
    const el = textRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      autosize(el)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
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

    const len = el.value.length
    const whole = el.selectionStart === 0 && el.selectionEnd === len
    if (e.key === '/' && mod(e)) {
      // Ctrl+/ opens the menu wherever the caret is.
      e.preventDefault()
      onOpenActions(task.id, el)
    } else if (e.key === 'Backspace' && mod(e) && e.shiftKey) {
      e.preventDefault()
      dispatch({ type: 'remove', id: task.id })
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && !e.altKey && !mod(e)
      && (e.key === 'ArrowUp' ? el.selectionStart === 0 && (collapsedSel || whole) : el.selectionEnd === len && (collapsedSel || whole))) {
      e.preventDefault()
      dispatch({ type: 'commit', id: task.id })
      onSelectRows(task.id, e.key === 'ArrowUp' ? -1 : 1)
    } else if (e.key.toLowerCase() === 'a' && mod(e) && !e.shiftKey && (whole || !len)) {
      // Ctrl+A twice: the text, then every row.
      e.preventDefault()
      dispatch({ type: 'commit', id: task.id })
      onSelectRows(task.id, 'all')
    } else if (e.key === 'Enter' && mod(e)) {
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
    } else if (e.key === '/' && collapsedSel && (caret === 0 || /\s/.test(el.value[caret - 1]) || (caret === len && !/\d/.test(el.value[caret - 1])))) {
      // At the start, after a space, or at the end of the line (but "3/" stays a date being typed).
      e.preventDefault()
      onOpenActions(task.id, el)
    } else if (e.altKey && e.code === 'KeyH') {
      e.preventDefault()
      dispatch({ type: 'toggle-today', id: task.id })
    } else if (e.altKey && e.code === 'KeyU') {
      e.preventDefault()
      const next = toggleMark(el.value, el.selectionStart, el.selectionEnd)
      if (next.text === el.value) return
      dispatch({ type: 'edit', id: task.id, patch: { text: next.text } })
      requestAnimationFrame(() => el.setSelectionRange(next.start, next.end))
    } else if (e.altKey && e.code === 'KeyL') {
      e.preventDefault()
      dispatch({ type: 'commit', id: task.id })
      if (isSnoozed(task, today)) dispatch({ type: 'unsnooze', id: task.id })
      else onOpenActions(task.id, el, 'snooze')
    } else if (e.key === 'Escape') {
      el.blur()
    }
  }

  // Several lines pasted at once become several tasks, nested by their indentation.
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (!/\n\s*\S/.test(text.trim())) return
    e.preventDefault()
    dispatch({ type: 'commit', id: task.id })
    dispatch({ type: 'paste', id: task.id, text, inherit })
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

  const marked = hasMark(task.text)
  const textarea = (
    <textarea
      ref={textRef}
      className="text"
      data-task-text={task.id}
      rows={1}
      value={task.text}
      placeholder={depth === 0 ? 'Escribe una tarea…   #tag   !   mañana' : 'Subtarea…'}
      spellCheck={false}
      onChange={(e) => dispatch({ type: 'edit', id: task.id, patch: { text: e.target.value } })}
      onKeyDown={onTextKey}
      onPaste={onPaste}
      onBlur={() => dispatch({ type: 'commit', id: task.id })}
    />
  )

  return (
    <div
      className="row"
      data-row-id={task.id}
      data-status={task.status}
      data-dragging={dragging || undefined}
      data-dimmed={dimmed || undefined}
      data-faded={faded || undefined}
      data-selected={selected || undefined}
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
        onClick={(e) => {
          dispatch({ type: 'toggle-collapse', id: task.id })
          if (byPointer(e)) teach('collapse', `${M}.`)
        }}
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
        onClick={(e) => {
          dispatch({ type: 'toggle-done', id: task.id })
          if (byPointer(e)) teach('complete', `${M}↵`)
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 5.2l2 2L8 3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>

      <div className="body">
        <div className="line">
          {task.priority && (
            <span className="prio" title="Prioridad">
              !
            </span>
          )}
          {/* Always this wrapper, so the editor keeps its focus when a highlight comes or goes. */}
          <div className={marked ? 'text text-marked' : 'text-plain'}>
            {marked && (
              // The words drawn behind the (see-through) editor, highlights included.
              <div className="text-ink" aria-hidden>
                {segments(task.text, true).map((seg, i) =>
                  seg.marked ? (
                    <mark key={i}>
                      <span className="mark-sign">==</span>
                      {seg.text.slice(2, -2)}
                      <span className="mark-sign">==</span>
                    </mark>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  ),
                )}
                {'\u200b'}
              </div>
            )}
            {textarea}
          </div>
          {task.snooze && isSnoozed(task, today) && (
            <span className="snooze" data-state="away" title={`Pospuesta hasta ${dueLabel(task.snooze.until, new Date(`${today}T12:00`)).toLowerCase()} (${isMac ? '⌥' : 'Alt+'}L la devuelve)`}>
              → {dueLabel(task.snooze.until, new Date(`${today}T12:00`)).toLowerCase()}
            </span>
          )}
          {task.snooze && isBack(task, today) && task.status !== 'done' && (
            <span className="snooze" data-state="back" title={`Pospuesta hace ${daysAway(task)} d; vuelve hoy`}>
              {task.tags.includes(WAITING_TAG) ? `sin respuesta · ${daysWaiting(task, today)} d` : `↩ ${daysAway(task)} d`}
            </span>
          )}
          {task.due && <DueLabel due={task.due} done={task.status === 'done'} repeat={task.repeat} />}
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
            <button className="note-toggle" tabIndex={-1} title="Añadir nota (⇧↵)" onClick={(e) => {
              dispatch({ type: 'focus', id: task.id, target: 'notes' })
              if (byPointer(e)) teach('note', '⇧↵')
            }}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M2 3h8M2 6h8M2 9h5" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            </button>
          )}
          {drafted && task.status !== 'done' && (
            <span className="draft-mark" title={`Borrador listo (${isMac ? '⌥' : 'Alt+'}D)`} aria-label="Borrador listo">
              ✎
            </span>
          )}
          {task.source && (
            <a
              className="source"
              href={task.source.url}
              target="_blank"
              rel="noopener"
              tabIndex={-1}
              title={`${task.source.quote ? `«${task.source.quote}»\n` : ''}Abrir en ${SOURCE_APP[task.source.app]} (${isMac ? '⌥' : 'Alt+'}O)`}
            >
              {SOURCE_LABEL[task.source.app]}
              <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
                <path d="M2 6l4-4M3 2h3v3" fill="none" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            </a>
          )}
          <time
            className="date"
            data-stale={stale || undefined}
            dateTime={new Date(task.createdAt).toISOString()}
            title={`Creada el ${fullDateFmt.format(task.createdAt)}`}
          >
            {stale ? `${ageInDays(task, today)} d` : dateFmt.format(task.createdAt).replace('.', '')}
          </time>
          <button
            className="del"
            tabIndex={-1}
            aria-label="Borrar"
            title={`Borrar (${M}⇧⌫)`}
            onClick={(e) => {
              dispatch({ type: 'remove', id: task.id })
              if (byPointer(e)) teach('delete', `${M}⇧⌫`)
            }}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden>
              <path d="M1.5 1.5l6 6M7.5 1.5l-6 6" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
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
