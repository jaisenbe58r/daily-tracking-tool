import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BoardView } from './components/BoardView'
import { ListView } from './components/ListView'
import { Toolbar } from './components/Toolbar'
import { exportTasks, readBackup } from './lib/backup'
import { allTags, isFiltering, organize } from './lib/organize'
import { usePrefs, type View } from './lib/prefs'
import { useTasks } from './lib/store'
import { dateKey } from './lib/parse'
import { TodayContext } from './lib/today'

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
  const filtering = isFiltering(effective)
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const tasksRef = useRef(state.tasks)
  useEffect(() => {
    tasksRef.current = state.tasks
  }, [state.tasks])

  const notify = useCallback((text: string) => setToast({ text, id: Date.now() }), [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(timer)
  }, [toast])

  const importFile = useCallback(
    async (file: File) => {
      try {
        const tasks = await readBackup(file)
        dispatch({ type: 'import', tasks })
        notify(`${plural(tasks.length, 'tarea')} ${tasks.length === 1 ? 'importada' : 'importadas'} · ${isMac ? '⌘' : 'Ctrl+'}Z deshace`)
      } catch {
        notify('Ese archivo no es una copia de Daily Tracking Tool')
      }
    },
    [dispatch, notify],
  )
  const exportAll = useCallback(() => notify(`Copia guardada: ${exportTasks(tasksRef.current)}`), [notify])
  const openImport = useCallback(() => fileRef.current?.click(), [])

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
        if (key === 's' || key === 'o') {
          e.preventDefault()
          if (key === 's') exportAll()
          else openImport()
        } else if (key === 'z' || redo) {
          e.preventDefault()
          dispatch({ type: redo ? 'redo' : 'undo' })
        }
      } else if (e.altKey && (e.code === 'Digit1' || e.code === 'Digit2')) {
        e.preventDefault()
        setView(e.code === 'Digit1' ? 'list' : 'board')
      } else if (e.altKey && e.code === 'KeyT') {
        e.preventDefault()
        setPrefs((p) => ({ ...p, filters: { ...p.filters, today: !p.filters.today } }))
      }
    }
    // Dropping a backup file anywhere on the page imports it.
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      const file = e.dataTransfer?.files[0]
      if (!file) return
      e.preventDefault()
      void importFile(file)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [dispatch, setView, setPrefs, exportAll, openImport, importFile])

  // Keep the heading right when the tab stays open past midnight.
  useEffect(() => {
    const timer = setInterval(() => setToday(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const open = state.tasks.filter((t) => t.status !== 'done' && t.text.trim()).length
  const done = state.tasks.filter((t) => t.status === 'done').length

  return (
    <TodayContext.Provider value={dateKey(today)}>
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
              onExport={exportAll}
              onImport={openImport}
            />
          ) : (
            <BoardView tasks={state.tasks} dispatch={dispatch} filters={effective} onTagClick={toggleTag} />
          )}
        </main>

        <footer className="hints" aria-hidden>
          {view === 'list' ? (
            <>
              <span><kbd>↵</kbd> nueva</span>
              <span><kbd>⇥</kbd> subtarea</span>
              <span><kbd>{isMac ? '⌘' : 'Ctrl'}↵</kbd> completar</span>
              <span><kbd>⇧↵</kbd> nota</span>
              <span><kbd>{isMac ? '⌥' : 'Alt+'}H</kbd> para hoy</span>
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
          <span><kbd>{isMac ? '⌥' : 'Alt+'}T</kbd> hoy</span>
          <span><kbd>{isMac ? '⌥' : 'Alt+'}1</kbd><kbd>{isMac ? '⌥' : 'Alt+'}2</kbd> vista</span>
        </footer>

        <input
          ref={fileRef}
          id="import-file"
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void importFile(file)
            e.target.value = ''
          }}
        />

        {toast && (
          <div key={toast.id} className="toast" role="status">
            {toast.text}
          </div>
        )}
      </div>
    </TodayContext.Provider>
  )
}
