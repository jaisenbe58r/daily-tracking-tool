import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Action, AppState } from '../lib/store'
import { childrenOf, descendantIds, flatten, nextSibling } from '../lib/tree'
import type { Group, Row } from '../lib/types'
import { QuickActions } from './QuickActions'
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
}

export function ListView({ state, dispatch, groups, structural, grouped, activeTag, onTagClick }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const [actionsFor, setActionsFor] = useState<{ id: string; anchor: DOMRect } | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  const openActions = useCallback((id: string, anchor: HTMLElement) => {
    setActionsFor({ id, anchor: anchor.getBoundingClientRect() })
  }, [])

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

  const rows = groups.flatMap((g) => g.rows)
  const actionsRow = actionsFor && rows.find((r) => r.task.id === actionsFor.id)
  const empty = rows.length === 0

  return (
    <>
      <div className="list" ref={listRef} data-dragging={drag ? true : undefined}>
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
                dispatch={dispatch}
                onOpenActions={openActions}
                onDragStart={startDrag}
                structural={structural}
                inherit={group.inherit}
                activeTag={activeTag}
                onTagClick={onTagClick}
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
          dispatch={dispatch}
          onClose={(refocus) => {
            setActionsFor(null)
            if (refocus) dispatch({ type: 'focus', id: actionsFor.id })
          }}
        />
      )}
    </>
  )
}
