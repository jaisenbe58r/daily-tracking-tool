import { useLayoutEffect, useRef } from 'react'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const M = isMac ? '⌘' : 'Ctrl'

export type MeaningSearch = 'idle' | 'searching' | 'found' | 'failed'

interface Props {
  query: string
  results: number
  onChange: (query: string) => void
  onClose: () => void
  /** Enter / ↓: jump into the first result. */
  onEnter: () => void
  /** Search by meaning with the AI (Cmd/Ctrl+Enter); absent when there's no AI. */
  meaning?: { state: MeaningSearch; onAsk: () => void } | null
}

/** Cmd/Ctrl+F: filters as you type; parents stay dimmed as context. Esc clears it. */
export function SearchBar({ query, results, onChange, onClose, onEnter, meaning }: Props) {
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
          if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey) && meaning && query.trim()) {
            e.preventDefault()
            meaning.onAsk()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
            e.preventDefault()
            onEnter()
          }
        }}
      />
      {query.trim() && meaning?.state === 'searching' ? (
        <span className="search-count">buscando…</span>
      ) : (
        query.trim() && (
          <span className="search-count">
            {results === 1 ? '1 resultado' : `${results} resultados`}
            {meaning?.state === 'found' && ' por significado'}
            {meaning?.state === 'failed' && ' · la IA no respondió'}
          </span>
        )
      )}
      {/* Offered only when the words find nothing: that's when meaning helps. */}
      {query.trim() && meaning?.state === 'idle' && results === 0 && (
        <button type="button" className="search-ai" onClick={meaning.onAsk}>
          <kbd>{M}↵</kbd> con IA
        </button>
      )}
      <kbd>esc</kbd>
    </div>
  )
}
