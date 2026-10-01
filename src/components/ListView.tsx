import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { Action, AppState } from '../lib/store'
import { childrenOf, descendantIds, flatten, nextSibling } from '../lib/tree'
import type { Group, Row } from '../lib/types'
import { QuickActions, type QuickItem, type SubMenu } from './QuickActions'
import { TaskRow } from './TaskRow'

const INDENT = 24

interface Drag {
  /** Where the drop line sits (px, relative to the list) and at which depth. */
  y: number
  depth: number
  parentId: string | null
  beforeId: string | null
  /** The dragged task and its subtree. */
  moving: Set<string>
}

interface Props {
  state: AppState
  dispatch: (action: Action) => void
  groups: Group[]
  /** The editable tree (manual order, nothing filtered out). */
  structural: boolean
  grouped: boolean
  activeTag: string | null
  onTagClick: (tag: string) => void
  /** App-wide entries for the "/" menu, built for the task it was opened on. */
  extraActions: (taskId: string) => QuickItem[]
  /** Focus mode: every task outside this set is faded. */
  focused: Set<string> | null
  /** How many rows are selected, for the shortcut bar. */
  onSelection?: (count: number) => void
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const isEditable = (el: Element | null) => !!el && (el.matches('input, textarea, select, [contenteditable="true"]') || !!el.closest('.qa, .capture, .search, dialog'))

/** A row selection: from `anchor` to `head` in the visible order, plus rows added with Ctrl/Cmd+click. */
interface Selection {
  anchor: string
  head: string
  ids: Set<string>
}

export function ListView({ state, dispatch, groups, structural, grouped, activeTag, onTagClick, extraActions, focused, onSelection }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const [actionsFor, setActionsFor] = useState<{ id: string; anchor: DOMRect; sub: SubMenu | null } | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  const openActions = useCallback((id: string, anchor: HTMLElement, sub: SubMenu | null = null) => {
    setActionsFor({ id, anchor: anchor.getBoundingClientRect(), sub })
  }, [setActionsFor])

  const rows = groups.flatMap((g) => g.rows)
  const order = rows.map((r) => r.task.id)
  const orderRef = useRef(order)
  useLayoutEffect(() => {
    orderRef.current = order
  })

  const [rawSel, setSel] = useState<Selection | null>(null)
  // Rows that disappear (deleted, filtered out) leave the selection.
  const kept = rawSel ? [...rawSel.ids].filter((id) => order.includes(id)) : []
  const sel = rawSel && kept.length ? { ...rawSel, ids: new Set(kept) } : null
  const range = (anchor: string, head: string) => {
    const ids = orderRef.current
    const [a, b] = [ids.indexOf(anchor), ids.indexOf(head)].sort((x, y) => x - y)
    return new Set(a < 0 ? [head] : ids.slice(a, b + 1))
  }
  const takeKeys = () => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    listRef.current?.focus({ preventScroll: true })
  }
  const clearSel = (focusId?: string) => {
    setSel(null)
    if (focusId) dispatch({ type: 'focus', id: focusId })
  }

  const selectRows = useCallback((id: string, dir: -1 | 1 | 'all') => {
    const ids = orderRef.current
    let next: Selection
    if (dir === 'all') {
      next = { anchor: ids[0], head: ids.at(-1)!, ids: new Set(ids) }
    } else {
      const head = ids[ids.indexOf(id) + dir] ?? id
      const [a, b] = [ids.indexOf(id), ids.indexOf(head)].sort((x, y) => x - y)
      next = { anchor: id, head, ids: new Set(ids.slice(a, b + 1)) }
    }
    setSel(next)
    ;(document.activeElement as HTMLElement | null)?.blur()
    listRef.current?.focus({ preventScroll: true })
  }, [])

  const selCount = sel?.ids.size ?? 0
  useEffect(() => onSelection?.(selCount), [selCount, onSelection])

  const onSelKey = (e: ReactKeyboardEvent) => {
    if (!sel) return
    const mod = isMac ? e.metaKey : e.ctrlKey
    const ids = [...sel.ids]
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey) {
      e.preventDefault()
      const head = order[order.indexOf(sel.head) + (e.key === 'ArrowUp' ? -1 : 1)] ?? sel.head
      setSel({ ...sel, head, ids: range(sel.anchor, head) })
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      clearSel(sel.head)
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      setSel(null)
      dispatch({ type: 'remove-many', ids })
    } else if (e.key === 'Enter' && mod) {
      e.preventDefault()
      dispatch({ type: 'done-many', ids })
    } else if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault()
      clearSel(sel.head)
    } else if (e.key.toLowerCase() === 'a' && mod) {
      e.preventDefault()
      setSel({ anchor: order[0], head: order.at(-1)!, ids: new Set(order) })
    }
  }

  // Shift+click extends from the row being edited (or the selection); Ctrl/Cmd+click adds or removes one row.
  const onListPointerDown = (e: ReactPointerEvent) => {
    const id = (e.target as Element).closest<HTMLElement>('[data-row-id]')?.dataset.rowId
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (!id || (!e.shiftKey && !mod)) {
      if (sel) setSel(null)
      return
    }
    const from = sel?.anchor ?? (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId ?? state.focus?.id
    if (!from && !mod) return
    e.preventDefault()
    if (mod) {
      const ids = new Set(sel?.ids ?? (state.focus ? [state.focus.id] : []))
      if (ids.has(id)) ids.delete(id)
      else ids.add(id)
      setSel(ids.size ? { anchor: id, head: id, ids } : null)
    } else {
      setSel({ anchor: from!, head: id, ids: range(from!, id) })
    }
    takeKeys()
  }

  // "/" with no line being edited opens the menu on the last task you were on (or the first).
  const focusId = state.focus?.id
  const selHead = sel?.head
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.altKey || isEditable(document.activeElement) || actionsFor) return
      const id = selHead ?? (focusId && orderRef.current.includes(focusId) ? focusId : orderRef.current[0])
      const el = id && document.querySelector<HTMLElement>(`[data-task-text="${id}"]`)
      if (!el) return
      e.preventDefault()
      setSel(null)
      openActions(id, el)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusId, selHead, actionsFor, openActions])

  // Pointer-driven tree drag & drop: vertical position picks the gap between
  // rows, horizontal offset picks the nesting depth (clamped to what's valid).
  const startDrag = useCallback(
    (id: string, e: ReactPointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      const tasks = state.tasks
      const startX = e.clientX
      const startY = e.clientY
      const moving = new Set([id, ...descendantIds(tasks, id)])
      const all = flatten(tasks)
      const origin = all.find((r) => r.task.id === id)
      if (!origin) return
      const candidates = all.filter((r) => !moving.has(r.task.id))
      let active = false
      let current: Drag | null = null

      const onMove = (ev: PointerEvent) => {
        if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return
        active = true
        const list = listRef.current
        if (!list) return
        const listTop = list.getBoundingClientRect().top
        const rects = candidates.map((r) => list.querySelector(`[data-row-id="${r.task.id}"]`)!.getBoundingClientRect())
        let gap = rects.findIndex((rect) => ev.clientY < rect.top + rect.height / 2)
        if (gap < 0) gap = candidates.length
        const prev: Row | undefined = candidates[gap - 1]
        const next: Row | undefined = candidates[gap]
        const wanted = origin.depth + Math.round((ev.clientX - startX) / INDENT)
        const depth = Math.max(next?.depth ?? 0, Math.min(prev ? prev.depth + 1 : 0, wanted))
        const y = (gap < rects.length ? rects[gap].top : (rects.at(-1)?.bottom ?? listTop)) - listTop

        let parentId: string | null = null
        let beforeId: string | null = null
        if (prev && depth === prev.depth + 1) {
          parentId = prev.task.id
          beforeId = childrenOf(tasks, prev.task.id).find((t) => !moving.has(t.id))?.id ?? null
        } else if (prev) {
          // Walk up from `prev` to its ancestor at the target depth; we drop right after it.
          let anchor = prev
          for (let i = gap - 1; i >= 0 && anchor.depth > depth; i--) {
            if (candidates[i].task.id === anchor.task.parentId) anchor = candidates[i]
          }
          parentId = anchor.task.parentId
          let after = nextSibling(tasks, anchor.task.id)
          while (after && moving.has(after.id)) after = nextSibling(tasks, after.id)
          beforeId = after?.id ?? null
        } else {
          beforeId = next?.task.id ?? null
        }
        current = { y, depth, parentId, beforeId, moving }
        setDrag(current)
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        if (current) dispatch({ type: 'move-to', id, parentId: current.parentId, beforeId: current.beforeId })
        setDrag(null)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [state.tasks, dispatch],
  )

  // Clicking the blank paper below the list continues writing.
  const onPaperClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return
    const last = groups.at(-1)?.rows.at(-1)?.task
    if (last && !last.text.trim() && last.parentId === null) dispatch({ type: 'focus', id: last.id })
    else dispatch({ type: 'add-end', inherit: groups.length === 1 ? groups[0].inherit : {} })
  }

  const actionsRow = actionsFor && rows.find((r) => r.task.id === actionsFor.id)
  const empty = rows.length === 0

  return (
    <>
      <div
        className="list"
        ref={listRef}
        tabIndex={-1}
        data-dragging={drag ? true : undefined}
        onPointerDownCapture={onListPointerDown}
        onKeyDown={onSelKey}
        onBlur={(e) => { if (rawSel && !e.currentTarget.contains(e.relatedTarget as Node | null)) setSel(null) }}
        aria-multiselectable
      >
        {groups.map((group) => (
          <section key={group.key} className="group">
            {grouped && (
              <h2 className="group-head">
                <span>{group.label}</span>
                <span className="group-count">{group.rows.length}</span>
              </h2>
            )}
            {group.rows.map((row) => (
              <TaskRow
                key={row.task.id}
                row={row}
                focus={state.focus?.id === row.task.id ? state.focus : null}
                dragging={!!drag?.moving.has(row.task.id)}
                faded={!!focused && !focused.has(row.task.id)}
                dispatch={dispatch}
                onOpenActions={openActions}
                onDragStart={startDrag}
                structural={structural}
                inherit={group.inherit}
                activeTag={activeTag}
                onTagClick={onTagClick}
                selected={!!sel?.ids.has(row.task.id)}
                onSelectRows={selectRows}
              />
            ))}
          </section>
        ))}
        {empty && <p className="empty">{activeTag ? `Nada con #${activeTag} todavía.` : 'Nada por aquí.'} Haz clic abajo para escribir.</p>}
        {drag && <div className="drop-line" style={{ top: drag.y, left: `calc(var(--gutter) + ${drag.depth * INDENT}px)` }} />}
      </div>

      <div className="paper" onClick={onPaperClick} />

      {actionsFor && actionsRow && (
        <QuickActions
          task={actionsRow.task}
          hasChildren={actionsRow.hasChildren}
          anchor={actionsFor.anchor}
          initialSub={actionsFor.sub}
          dispatch={dispatch}
          extra={extraActions(actionsRow.task.id)}
          onClose={(refocus) => {
            setActionsFor(null)
            if (refocus) dispatch({ type: 'focus', id: actionsFor.id })
          }}
        />
      )}
    </>
  )
}
