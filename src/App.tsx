import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BoardView } from './components/BoardView'
import { ListView } from './components/ListView'
import type { QuickItem } from './components/QuickActions'
import { QuickCapture } from './components/QuickCapture'
import { SearchBar } from './components/SearchBar'
import { Toolbar } from './components/Toolbar'
import { exportTasks, readBackup } from './lib/backup'
import { allTags, inheritFromFilters, isFiltering, matches, organize } from './lib/organize'
import { usePrefs, type View } from './lib/prefs'
import { useTasks } from './lib/store'
import { dateKey, parseTask } from './lib/parse'
import { TodayContext } from './lib/today'
import { dailySummary, subtreeOutline } from './lib/daily'
import { useTemplates } from './lib/templates'
import { descendantIds } from './lib/tree'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const M = isMac ? '⌘' : 'Ctrl '
const A = isMac ? '⌥' : 'Alt '
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
  const { templates, save: saveTemplate, remove: removeTemplate, replaceAll: replaceTemplates } = useTemplates()
  const [capturing, setCapturing] = useState(false)
  const [searching, setSearching] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const todayKey = dateKey(today)

  // Latest values for handlers registered once.
  const latest = useRef({ tasks: state.tasks, templates, focusId, todayKey })
  useEffect(() => {
    latest.current = { tasks: state.tasks, templates, focusId, todayKey }
  }, [state.tasks, templates, focusId, todayKey])

  const focusTask = focusId ? state.tasks.find((t) => t.id === focusId) : undefined
  const focused = useMemo(
    () => (focusTask ? new Set([focusTask.id, ...descendantIds(state.tasks, focusTask.id)]) : null),
    [focusTask, state.tasks],
  )

  // First visit of a new day: what's still open from before rises to the top.
  const { lastDay } = prefs
  useEffect(() => {
    if (lastDay === todayKey) return
    dispatch({ type: 'carry-over', today: todayKey })
    setPrefs((p) => ({ ...p, lastDay: todayKey }))
  }, [lastDay, todayKey, dispatch, setPrefs])

  const notify = useCallback((text: string) => setToast({ text, id: Date.now() }), [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(timer)
  }, [toast])

  const importFile = useCallback(
    async (file: File) => {
      try {
        const { tasks, templates: saved } = await readBackup(file)
        dispatch({ type: 'import', tasks })
        if (saved.length) replaceTemplates(saved)
        notify(`${plural(tasks.length, 'tarea')} ${tasks.length === 1 ? 'importada' : 'importadas'} · ${isMac ? '⌘' : 'Ctrl+'}Z deshace`)
      } catch {
        notify('Ese archivo no es una copia de Daily Tracking Tool')
      }
    },
    [dispatch, notify, replaceTemplates],
  )
  const exportAll = useCallback(
    () => notify(`Copia guardada: ${exportTasks(latest.current.tasks, latest.current.templates)}`),
    [notify],
  )
  const openImport = useCallback(() => fileRef.current?.click(), [])

  const copySummary = useCallback(() => {
    const text = dailySummary(latest.current.tasks, latest.current.todayKey)
    navigator.clipboard
      ?.writeText(text)
      .then(() => notify('Resumen del día copiado'))
      .catch(() => notify('No se pudo copiar el resumen'))
  }, [notify])

  const closeSearch = () => {
    setSearching(false)
    setPrefs((p) => ({ ...p, filters: { ...p.filters, query: '' } }))
  }
  const searchResults = filters.query.trim()
    ? view === 'list'
      ? groups.reduce((n, g) => n + g.rows.filter((r) => !r.dimmed).length, 0)
      : state.tasks.filter((t) => t.text.trim() && matches(t, { ...effective, hideDone: false }, todayKey)).length
    : 0
  const jumpToFirstResult = () => {
    if (view === 'board') {
      document.querySelector<HTMLElement>('[data-card-id]')?.focus()
      return
    }
    const first = groups.flatMap((g) => g.rows).find((r) => !r.dimmed)
    if (first) dispatch({ type: 'focus', id: first.task.id })
  }

  // Capture (Cmd/Ctrl+K) hands focus back to where the user was typing.
  const returnTo = useRef<HTMLElement | null>(null)
  const restoreFocus = () =>
    requestAnimationFrame(() => {
      // Only if nothing else claimed focus in the meantime (e.g. ⌘F right after Esc).
      const active = document.activeElement
      if (!active || active === document.body) returnTo.current?.focus?.()
    })

  /** The task whose row (or card) has keyboard focus. */
  const activeTaskId = () => {
    const el = document.activeElement as HTMLElement | null
    return el?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId ?? el?.closest<HTMLElement>('[data-card-id]')?.dataset.cardId ?? null
  }
  const toggleFocusMode = useCallback((id: string | null) => {
    setFocusId((cur) => (cur && (cur === id || !id) ? null : id))
  }, [])

  const extraActions = useCallback(
    (taskId: string): QuickItem[] => {
      const task = state.tasks.find((t) => t.id === taskId)
      const name = task?.text.trim()
      return [
        { label: focusId === taskId ? 'Salir del foco' : 'Modo foco', hint: `${A}F`, keywords: 'foco focus concentrar', run: () => toggleFocusMode(taskId) },
        ...(name
          ? [{ label: 'Guardar como plantilla', keywords: 'plantilla template', run: () => {
              saveTemplate({ name, outline: subtreeOutline(state.tasks, taskId) })
              notify(`Plantilla guardada: ${name}`)
              dispatch({ type: 'focus', id: taskId })
            } }]
          : []),
        ...templates.map((t) => ({
          label: `Plantilla · ${t.name}`,
          keywords: 'plantilla template insertar',
          run: () => dispatch({ type: 'paste', id: taskId, text: t.outline }),
        })),
        ...templates.map((t) => ({
          label: `Borrar plantilla · ${t.name}`,
          keywords: 'plantilla template borrar eliminar quitar',
          searchOnly: true,
          run: () => {
            removeTemplate(t.name)
            notify(`Plantilla borrada: ${t.name}`)
            dispatch({ type: 'focus', id: taskId })
          },
        })),
        { label: 'Copiar resumen del día', hint: `${A}R`, keywords: 'resumen daily markdown portapapeles', run: () => { copySummary(); dispatch({ type: 'focus', id: taskId }) } },
        { label: 'Buscar', hint: `${M}F`, keywords: 'buscar filtrar search', run: () => setSearching(true) },
        { label: 'Exportar copia', hint: `${M}S`, keywords: 'backup json guardar descargar', run: exportAll },
        { label: 'Importar copia', hint: `${M}O`, keywords: 'backup json abrir cargar restaurar', run: openImport },
      ]
    },
    [state.tasks, templates, focusId, toggleFocusMode, saveTemplate, removeTemplate, notify, dispatch, copySummary, exportAll, openImport],
  )

  const setView = useCallback((v: View) => setPrefs((p) => ({ ...p, view: v })), [setPrefs])
  const toggleTag = useCallback(
    (t: string) => setPrefs((p) => ({ ...p, filters: { ...p.filters, tag: p.filters.tag === t ? null : t } })),
    [setPrefs],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.qa, .capture, .search')) return
      // Undo/redo covers typing and structure alike, replacing the browser's per-field undo.
      if (isMac ? e.metaKey : e.ctrlKey) {
        const key = e.key.toLowerCase()
        const redo = (key === 'z' && e.shiftKey) || (!isMac && key === 'y')
        if (key === 's' || key === 'o') {
          e.preventDefault()
          if (key === 's') exportAll()
          else openImport()
        } else if (key === 'k') {
          e.preventDefault()
          returnTo.current = document.activeElement as HTMLElement | null
          setCapturing(true)
        } else if (key === 'f') {
          e.preventDefault()
          setSearching(true)
          // Already open: take the cursor back to it, ready to retype.
          const input = document.getElementById('search') as HTMLInputElement | null
          input?.focus()
          input?.select()
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
      } else if (e.altKey && e.code === 'KeyF') {
        e.preventDefault()
        toggleFocusMode(activeTaskId())
      } else if (e.altKey && e.code === 'KeyR') {
        e.preventDefault()
        copySummary()
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
  }, [dispatch, setView, setPrefs, exportAll, openImport, importFile, toggleFocusMode, copySummary])

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
            {searching && (
              <SearchBar
                query={filters.query}
                results={searchResults}
                onChange={(query) => setPrefs((p) => ({ ...p, filters: { ...p.filters, query } }))}
                onClose={closeSearch}
                onEnter={jumpToFirstResult}
              />
            )}
            <Toolbar
              view={view}
              sort={sort}
              filters={effective}
              tags={tags}
              onSort={(s) => setPrefs((p) => ({ ...p, sort: s }))}
              onFilters={(f) => setPrefs((p) => ({ ...p, filters: f }))}
              focusName={view === 'list' && focusTask ? focusTask.text.trim() : null}
              onExitFocus={() => setFocusId(null)}
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
              extraActions={extraActions}
              focused={focused}
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
          <span><kbd>{isMac ? '⌘' : 'Ctrl'}K</kbd> capturar</span>
          <span><kbd>{isMac ? '⌘' : 'Ctrl'}F</kbd> buscar</span>
          <span><kbd>{isMac ? '⌥' : 'Alt+'}T</kbd> hoy</span>
          <span><kbd>{isMac ? '⌥' : 'Alt+'}1</kbd><kbd>{isMac ? '⌥' : 'Alt+'}2</kbd> vista</span>
        </footer>

        {capturing && (
          <QuickCapture
            onCapture={(text) => {
              dispatch({ type: 'create', text, status: 'todo', inherit: inheritFromFilters(effective, todayKey) })
              setCapturing(false)
              notify(`Apuntada: ${parseTask(text).text || text.trim()}`)
              restoreFocus()
            }}
            onClose={() => {
              setCapturing(false)
              restoreFocus()
            }}
          />
        )}

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
