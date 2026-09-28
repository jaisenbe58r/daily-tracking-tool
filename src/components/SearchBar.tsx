import { useLayoutEffect, useRef } from 'react'

interface Props {
  query: string
  results: number
  onChange: (query: string) => void
  onClose: () => void
  /** Enter / ↓: jump into the first result. */
  onEnter: () => void
}

/** Cmd/Ctrl+F: filters as you type; parents stay dimmed as context. Esc clears it. */
export function SearchBar({ query, results, onChange, onClose, onEnter }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <div className="search" role="search">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M7.8 7.8L11 11" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      <input
        ref={ref}
        id="search"
        className="search-input"
        value={query}
        placeholder="Buscar…"
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
            e.preventDefault()
            onEnter()
          }
        }}
      />
      {query.trim() && <span className="search-count">{results === 1 ? '1 resultado' : `${results} resultados`}</span>}
      <kbd>esc</kbd>
    </div>
  )
}
