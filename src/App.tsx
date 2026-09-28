import { useCallback, useEffect, useMemo, useState } from 'react'
import { BoardView } from './components/BoardView'
import { ListView } from './components/ListView'
import { Toolbar } from './components/Toolbar'
import { allTags, organize } from './lib/organize'
import { usePrefs, type View } from './lib/prefs'
import { useTasks } from './lib/store'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const todayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })

export default function App() {
  const [state, dispatch] = useTasks()
  const [prefs, setPrefs] = usePrefs()
  const [today, setToday] = useState(() => new Date())
  const { view, sort, filters } = prefs

  const tags = useMemo(() => allTags(state.tasks), [state.tasks])
  // A tag filter pointing at a tag nobody uses any more would show an empty sheet.
  const tag = filters.tag && tags.includes(filters.tag) ? filters.tag : null
  const effective = useMemo(() => ({ ...filters, tag }), [filters, tag])
  const groups = useMemo(() => organize(state.tasks, sort, effective, today.getTime()), [state.tasks, sort, effective, today])
  const filtering = effective.tag !== null || effective.hideDone

  const setView = useCallback((v: View) => setPrefs((p) => ({ ...p, view: v })), [setPrefs])
  const toggleTag = useCallback(
    (t: string) => setPrefs((p) => ({ ...p, filters: { ...p.filters, tag: p.filters.tag === t ? null : t } })),
    [setPrefs],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.qa')) return
      // Undo/redo covers typing and structure alike, replacing the browser's per-field undo.
      if (isMac ? e.metaKey : e.ctrlKey) {
        const key = e.key.toLowerCase()
        const redo = (key === 'z' && e.shiftKey) || (!isMac && key === 'y')
        if (key !== 'z' && !redo) return
        e.preventDefault()
        dispatch({ type: redo ? 'redo' : 'undo' })
      } else if (e.altKey && (e.code === 'Digit1' || e.code === 'Digit2')) {
        e.preventDefault()
        setView(e.code === 'Digit1' ? 'list' : 'board')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch, setView])

  // Keep the heading right when the tab stays open past midnight.
  useEffect(() => {
    const timer = setInterval(() => setToday(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const open = state.tasks.filter((t) => t.status !== 'done' && t.text.trim()).length
  const done = state.tasks.filter((t) => t.status === 'done').length

  return (
    <div className="app" data-view={view}>
      <header className="top">
        <div className="brand">Daily Tracking Tool</div>
        <div className="view-toggle" role="tablist" aria-label="Vista">
          {(['list', 'board'] as View[]).map((v, i) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              title={`${v === 'list' ? 'Lista' : 'Tablero'} (${isMac ? '⌥' : 'Alt+'}${i + 1})`}
              onClick={() => setView(v)}
            >
              {v === 'list' ? 'List' : 'Board'}
            </button>
          ))}
        </div>
        <div className="counts" aria-live="polite" title={`${plural(open, 'pendiente')} · ${plural(done, 'hecha')}`}>
          <span>{open}<span className="word"> {open === 1 ? 'pendiente' : 'pendientes'}</span></span>
          <span className="sep" />
          <span>{done}<span className="word"> {done === 1 ? 'hecha' : 'hechas'}</span></span>
        </div>
      </header>

      <main className="sheet">
        <div className="sheet-head">
          <h1 className="today">{todayFmt.format(today)}</h1>
          <Toolbar
            view={view}
            sort={sort}
            filters={effective}
            tags={tags}
            onSort={(s) => setPrefs((p) => ({ ...p, sort: s }))}
            onFilters={(f) => setPrefs((p) => ({ ...p, filters: f }))}
          />
        </div>

        {view === 'list' ? (
          <ListView
            state={state}
            dispatch={dispatch}
            groups={groups}
            structural={sort === 'manual' && !filtering}
            grouped={sort !== 'manual'}
            activeTag={effective.tag}
            onTagClick={toggleTag}
          />
        ) : (
          <BoardView tasks={state.tasks} dispatch={dispatch} activeTag={effective.tag} onTagClick={toggleTag} />
        )}
      </main>

      <footer className="hints" aria-hidden>
        {view === 'list' ? (
          <>
            <span><kbd>↵</kbd> nueva</span>
            <span><kbd>⇥</kbd> subtarea</span>
            <span><kbd>⇧⇥</kbd> subir nivel</span>
            <span><kbd>{isMac ? '⌘' : 'Ctrl'}↵</kbd> completar</span>
            <span><kbd>⇧↵</kbd> nota</span>
            <span><kbd>#</kbd> tag</span>
            <span><kbd>/</kbd> acciones</span>
          </>
        ) : (
          <>
            <span><kbd>←</kbd><kbd>→</kbd> cambiar columna</span>
            <span><kbd>↑</kbd><kbd>↓</kbd> moverse</span>
            <span><kbd>↵</kbd> editar</span>
            <span><kbd>{isMac ? '⌘' : 'Ctrl'}↵</kbd> completar</span>
          </>
        )}
        <span><kbd>{isMac ? '⌥' : 'Alt+'}1</kbd><kbd>{isMac ? '⌥' : 'Alt+'}2</kbd> vista</span>
      </footer>
    </div>
  )
}
