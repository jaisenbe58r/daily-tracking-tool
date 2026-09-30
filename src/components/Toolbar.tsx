import type { View } from '../lib/prefs'
import type { Filters, SortMode } from '../lib/types'
import { useNotice } from '../lib/teach'

const A = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥' : 'Alt+'

const SORTS: { mode: SortMode; label: string }[] = [
  { mode: 'manual', label: 'Manual' },
  { mode: 'date', label: 'Fecha' },
  { mode: 'status', label: 'Estado' },
  { mode: 'tag', label: 'Tag' },
]

interface Props {
  view: View
  sort: SortMode
  filters: Filters
  tags: string[]
  onSort: (mode: SortMode) => void
  onFilters: (filters: Filters) => void
  /** Name of the task in focus mode, if any. */
  focusName: string | null
  onExitFocus: () => void
  /** Open tasks planned for today or overdue. */
  leftToday: number
  /** Tasks postponed to a later day, and whether they're shown anyway. */
  snoozed: number
  showSnoozed: boolean
  onShowSnoozed: () => void
}

/** Deliberately quiet: small mono labels that only turn ink when active. */
export function Toolbar({ view, sort, filters, tags, onSort, onFilters, focusName, onExitFocus, leftToday, snoozed, showSnoozed, onShowSnoozed }: Props) {
  const { teach } = useNotice()
  return (
    <div className="toolbar">
      {view === 'list' && (
        <div className="tool" role="radiogroup" aria-label="Ordenar y agrupar">
          <span className="tool-label">Orden</span>
          {SORTS.map(({ mode, label }) => (
            <button key={mode} role="radio" aria-checked={sort === mode} onClick={() => onSort(mode)}>
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="tool">
        {focusName !== null && (
          <button aria-pressed title="Salir del modo foco (Alt+F)" className="focus-chip" onClick={(e) => {
            onExitFocus()
            if (e.detail > 0) teach('focus', `${A}F`)
          }}>
            Foco · {focusName || 'Sin título'} ×
          </button>
        )}
        <button
          aria-pressed={filters.today}
          title={`Solo lo planificado para hoy o vencido (${A}T)${leftToday ? ` · quedan ${leftToday}` : ''}`}
          onClick={(e) => {
            onFilters({ ...filters, today: !filters.today })
            if (e.detail > 0) teach('today', `${A}T`)
          }}
        >
          Hoy{leftToday > 0 && <span className="count">{leftToday}</span>}
        </button>
        {snoozed > 0 && (
          <button aria-pressed={showSnoozed} title={`${showSnoozed ? 'Ocultar' : 'Ver'} lo pospuesto (${A}L sobre una tarea la pospone o la devuelve)`} onClick={onShowSnoozed}>
            {snoozed} {snoozed === 1 ? 'pospuesta' : 'pospuestas'}
          </button>
        )}
        {view === 'list' && (
          <button aria-pressed={filters.hideDone} onClick={() => onFilters({ ...filters, hideDone: !filters.hideDone })}>
            Ocultar hechas
          </button>
        )}
        {tags.length > 0 && (
          <label className="tag-select" data-active={filters.tag !== null || undefined}>
            <span className="visually-hidden">Filtrar por tag</span>
            <select id="tag-filter" value={filters.tag ?? ''} onChange={(e) => onFilters({ ...filters, tag: e.target.value || null })}>
              <option value="">Todos los tags</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
          </label>
        )}
        {filters.tag && (
          <button className="clear" aria-label="Quitar filtro de tag" onClick={() => onFilters({ ...filters, tag: null })}>
            ×
          </button>
        )}
      </div>
    </div>
  )
}
