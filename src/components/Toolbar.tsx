import type { View } from '../lib/prefs'
import type { Filters, SortMode } from '../lib/types'

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
}

/** Deliberately quiet: small mono labels that only turn ink when active. */
export function Toolbar({ view, sort, filters, tags, onSort, onFilters }: Props) {
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
        <button
          aria-pressed={filters.today}
          title="Solo lo planificado para hoy o vencido (Alt+T)"
          onClick={() => onFilters({ ...filters, today: !filters.today })}
        >
          Hoy
        </button>
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
