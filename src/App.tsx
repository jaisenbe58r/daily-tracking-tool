import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BoardView } from './components/BoardView'
import { ListView } from './components/ListView'
import { KeysBar } from './components/KeysBar'
import { peopleIn } from './lib/suggest'
import type { QuickItem } from './components/QuickActions'
import { QuickCapture } from './components/QuickCapture'
import { SearchBar, type MeaningSearch } from './components/SearchBar'
import { Toolbar } from './components/Toolbar'
import { PlanStrip } from './components/PlanStrip'
import { exportTasks, readBackup } from './lib/backup'
import { allTags, inheritFromFilters, isFiltering, matches, organize } from './lib/organize'
import { usePrefs, type View } from './lib/prefs'
import { useTasks } from './lib/store'
import { RESCUE_KEY, rescued } from './lib/persist'
import { dateKey, parseTask } from './lib/parse'
import { TodayContext } from './lib/today'
import { dailySummary, subtreeOutline } from './lib/daily'
import { MAX_STEPS, planFromPicks, planSteps, togglePlanned, usePlan } from './lib/plan'
import { useTemplates } from './lib/templates'
import { descendantIds } from './lib/tree'
import { useAi } from './ai/useAi'
import { useInbox } from './ai/inbox/useInbox'
import { DRAFT_LABEL, draftContext, draftRequest, getDraft, setDraft, usePrefetchDrafts } from './ai/drafts'
import type { Meeting } from './ai/meeting'
import { hideSnoozed, snoozedCount } from './lib/snooze'
import { NoticeContext, useNoticeValue } from './lib/teach'
import { useEventLog } from './memory/log'

// The memory is its own view: loaded the first time it opens, so the sheet stays light.
const MemoryView = lazy(() => import('./memory/MemoryView'))

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const M = isMac ? '⌘' : 'Ctrl '
const A = isMac ? '⌥' : 'Alt+'
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
/** What the capture line opens with: the task it's about (AI context), text to send at once, and what kind of answer. */
interface Seed {
  taskId: string | null
  /** Shown in the line. */
  text: string
  /** `plan`: changes too, and applying them also sets the day's plan. */
  mode: 'changes' | 'summary' | 'draft' | 'plan'
  /** Sent instead of `text` while the line still shows it (a short label for a long instruction). */
  request?: string
}

const PLAN_REQUEST =
  'Planifica mi día: elige como máximo 3 tareas abiertas que más importen hoy (vencidas, arrastradas, en curso o prioritarias) y ponles fecha de hoy y prioridad. No toques el resto.'
const SUMMARY_REQUEST =
  'Redacta el resumen de mi día para compartirlo con el equipo: qué he cerrado, qué sigue en curso y qué queda para mañana. Breve, en frases, sin inventar nada.'

const RECOGER = 'Recoger del correo y la agenda'

const todayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })

export default function App() {
  const [state, dispatch] = useTasks()
  const [prefs, setPrefs] = usePrefs()
  const [today, setToday] = useState(() => new Date())
  const { view, sort, filters } = prefs

  const todayKey = dateKey(today)
  // Postponed tasks leave the sheet until their day, unless the user asks to see them.
  const [wantSnoozed, setShowSnoozed] = useState(false)
  const snoozed = snoozedCount(state.tasks, todayKey)
  const showSnoozed = wantSnoozed && snoozed > 0
  const shown = useMemo(() => (showSnoozed ? state.tasks : hideSnoozed(state.tasks, todayKey)), [showSnoozed, state.tasks, todayKey])
  const listState = useMemo(() => (shown === state.tasks ? state : { ...state, tasks: shown }), [shown, state])

  const tags = useMemo(() => allTags(state.tasks), [state.tasks])
  const people = useMemo(() => peopleIn(state.tasks), [state.tasks])
  // A tag filter pointing at a tag nobody uses any more would show an empty sheet.
  const tag = filters.tag && tags.includes(filters.tag) ? filters.tag : null
  const effective = useMemo(() => ({ ...filters, tag }), [filters, tag])
  const groups = useMemo(() => organize(shown, sort, effective, today.getTime()), [shown, sort, effective, today])
  const filtering = isFiltering(effective)
  // A save we couldn't read was kept aside rather than overwritten: the first notice says so.
  const [toast, setToast] = useState<{ text: string; id: number; zero?: boolean } | null>(() =>
    rescued ? { text: `La hoja guardada estaba dañada; se ha apartado sin borrarla (${RESCUE_KEY})`, id: 0 } : null,
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const { templates, save: saveTemplate, remove: removeTemplate, replaceAll: replaceTemplates } = useTemplates()
  const [selectedRows, setSelectedRows] = useState(0)
  const [capturing, setCapturing] = useState(false)
  /** What the capture line opens with: the task it's about (AI context) and any text to send right away. */
  const [seed, setSeed] = useState<Seed>({ taskId: null, text: '', mode: 'changes' })
  const [searching, setSearching] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const ai = useAi(state.tasks, todayKey)
  const { mode: aiMode, hasKey: aiHasKey, forgetKey } = ai
  const inbox = useInbox(ai.mode, state.tasks, todayKey)
  usePrefetchDrafts(ai.mode, inbox.available, state.tasks, todayKey)
  const aiReady = useRef(false)
  useEffect(() => {
    aiReady.current = ai.available
  }, [ai.available])
  const { log, merge: mergeLog } = useEventLog(state.tasks, state.external)
  /** Plan del día: the strip above the list, kept until midnight. */
  const [plan, setPlan] = usePlan(todayKey)
  const steps = useMemo(() => planSteps(plan, state.tasks, todayKey), [plan, state.tasks, todayKey])
  /** Memoria (Alt+M) is open, starting from this task's pages. */
  const [memory, setMemory] = useState<{ startTask: string | null } | null>(null)

  // Latest values for handlers registered once.
  const latest = useRef({ tasks: state.tasks, templates, focusId, todayKey, log, steps })
  useEffect(() => {
    latest.current = { tasks: state.tasks, templates, focusId, todayKey, log, steps }
  }, [state.tasks, templates, focusId, todayKey, log, steps])

  const focusTask = focusId ? state.tasks.find((t) => t.id === focusId) : undefined
  const focused = useMemo(
    () => (focusTask ? new Set([focusTask.id, ...descendantIds(state.tasks, focusTask.id)]) : null),
    [focusTask, state.tasks],
  )

  // First visit of a new day: what's still open from before rises to the top.
  const { lastDay } = prefs
  useEffect(() => {
    if (lastDay === todayKey) return
    dispatch({ type: 'carry-over', today: todayKey, lastDay })
    setPrefs((p) => ({ ...p, lastDay: todayKey }))
  }, [lastDay, todayKey, dispatch, setPrefs])

  const notify = useCallback((text: string) => setToast({ text, id: Date.now() }), [])
  const notice = useNoticeValue(notify)
  const { teach } = notice
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.zero ? 6000 : 3200)
    return () => clearTimeout(timer)
  }, [toast])

  const importFile = useCallback(
    async (file: File) => {
      try {
        const { tasks, templates: saved, log: history } = await readBackup(file)
        dispatch({ type: 'import', tasks })
        if (saved.length) replaceTemplates(saved)
        if (history.length) mergeLog(history)
        notify(`${plural(tasks.length, 'tarea')} ${tasks.length === 1 ? 'importada' : 'importadas'} · ${isMac ? '⌘' : 'Ctrl+'}Z deshace`)
      } catch {
        notify('Ese archivo no es una copia de Daily Tracking Tool')
      }
    },
    [dispatch, notify, replaceTemplates, mergeLog],
  )
  const exportAll = useCallback(
    () => notify(`Copia guardada: ${exportTasks(latest.current.tasks, latest.current.templates, latest.current.log)}`),
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

  const [meaning, setMeaning] = useState<MeaningSearch>('idle')
  const meaningRun = useRef<AbortController | null>(null)
  /** A new query (or none) drops what the AI found for the old one. */
  const setQuery = (query: string) => {
    meaningRun.current?.abort()
    setMeaning('idle')
    setPrefs((p) => ({ ...p, filters: { ...p.filters, query, ids: null } }))
  }
  const searchByMeaning = () => {
    const query = filters.query.trim()
    if (!query) return
    meaningRun.current?.abort()
    const ctrl = new AbortController()
    meaningRun.current = ctrl
    setMeaning('searching')
    ai.search(query, ctrl.signal).then(
      (ids) => {
        if (ctrl.signal.aborted) return
        setMeaning('found')
        setPrefs((p) => ({ ...p, filters: { ...p.filters, ids } }))
        // A row that reappears may take focus back (it was the last one edited); the search keeps it.
        requestAnimationFrame(() => document.getElementById('search')?.focus())
      },
      (error: unknown) => {
        if (ctrl.signal.aborted) return
        setMeaning('failed')
        // Key mode with no key yet: the key is asked for where AI answers appear, in the capture line.
        if (error instanceof Error && error.name === 'NeedsKey') notify(`Pon tu clave de Anthropic: ${M}K y luego ${M}↵`)
      },
    )
  }
  const closeSearch = () => {
    setSearching(false)
    setQuery('')
  }
  const searchResults = filters.query.trim()
    ? view === 'list'
      ? groups.reduce((n, g) => n + g.rows.filter((r) => !r.dimmed).length, 0)
      : shown.filter((t) => t.text.trim() && matches(t, { ...effective, hideDone: false }, todayKey)).length
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
  /** Bumped whenever the capture line closes, so a late answer doesn't reopen it. */
  const captureRun = useRef(0)
  const restoreFocus = () =>
    requestAnimationFrame(() => {
      // Only if nothing else claimed focus in the meantime (e.g. ⌘F right after Esc).
      const active = document.activeElement
      if (active && active !== document.body) return
      // The row it came from may be gone (the AI replaced an empty sheet): land on the first task instead.
      if (returnTo.current?.isConnected) returnTo.current.focus?.()
      else document.querySelector<HTMLElement>('textarea[data-task-text]')?.focus()
    })

  const closeCapture = () => {
    captureRun.current++
    if (!returnTo.current && seed.taskId && state.tasks.some((t) => t.id === seed.taskId)) dispatch({ type: 'focus', id: seed.taskId })
    else restoreFocus()
  }

  /** The task whose row (or card) has keyboard focus. */
  const activeTaskId = () => {
    const el = document.activeElement as HTMLElement | null
    return el?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId ?? el?.closest<HTMLElement>('[data-card-id]')?.dataset.cardId ?? null
  }
  const toggleFocusMode = useCallback((id: string | null) => {
    setFocusId((cur) => (cur && (cur === id || !id) ? null : id))
  }, [])

  const { ask, write } = ai
  /** Opens the capture line (about a task, if any); with `request`, asks the AI at once. */
  const openAi = useCallback(
    (taskId: string | null, request = '', mode: Seed['mode'] = 'changes', label = request) => {
      returnTo.current = taskId ? null : (document.activeElement as HTMLElement | null)
      setSeed({ taskId, text: label, mode, request })
      setCapturing(true)
      if (!request) return
      if (mode === 'summary') void write(request, `Resumen literal del día:\n${dailySummary(latest.current.tasks, latest.current.todayKey)}`)
      else void ask(request, taskId)
    },
    [ask, write],
  )
  const planDay = useCallback((taskId: string | null) => openAi(taskId, PLAN_REQUEST, 'plan', 'Planificar el día'), [openAi])
  const writeSummary = useCallback(
    (taskId: string | null) => openAi(taskId, SUMMARY_REQUEST, 'summary', 'Resumen del día'),
    [openAi],
  )

  const { present, fail, cancel: cancelAi, showText } = ai

  /**
   * Alt+D: the mail this task means writing, drafted from its thread in the user's voice.
   * A kept draft opens at once; `fresh` (Cmd+Enter in the line) writes it again, following `also` if typed.
   */
  const draftFor = useCallback(
    async (taskId: string | null, fresh = false, also = '') => {
      const task = taskId ? latest.current.tasks.find((t) => t.id === taskId) : undefined
      if (!task?.text.trim()) return
      const label = `${DRAFT_LABEL}: ${task.text.trim()}`
      const run = ++captureRun.current
      returnTo.current = null
      setSeed({ taskId: task.id, text: label, mode: 'draft' })
      setCapturing(true)
      const kept = fresh ? undefined : getDraft(task.id)
      if (kept) {
        showText(label, kept)
        return
      }
      present(label)
      try {
        const context = await draftContext(task)
        if (run !== captureRun.current) return
        const request = also ? `${draftRequest(task)}\nAdemás: ${also}` : draftRequest(task)
        void write(request, context, task.id, (text) => setDraft(task.id, text))
      } catch (error) {
        if (run === captureRun.current) fail(label, error)
      }
    },
    [showText, present, write, fail],
  )

  /** «Preparar reunión»: a note and a few subtasks for a meeting, as a proposal. */
  const prepareMeeting = useCallback(
    async (m: Meeting) => {
      const { meetingRequest, meetingTask, meetingWhen, prepareContext } = await import('./ai/meeting')
      const when = meetingWhen(m, latest.current.todayKey)
      const label = `Preparar reunión: ${m.title} (${when})`
      const existing = meetingTask(latest.current.tasks, m)
      const run = ++captureRun.current
      returnTo.current = null
      setSeed({ taskId: existing?.id ?? null, text: label, mode: 'changes' })
      setCapturing(true)
      present(label)
      try {
        const context = await prepareContext(m)
        if (run !== captureRun.current) return
        void ask(meetingRequest(m, when, Boolean(existing)), existing?.id ?? null, context)
      } catch (error) {
        if (run === captureRun.current) fail(label, error)
      }
    },
    [present, ask, fail],
  )
  const meetingItems = useCallback(async (): Promise<QuickItem[]> => {
    const { upcomingMeetings, meetingWhen } = await import('./ai/meeting')
    const meetings = (await upcomingMeetings()) ?? []
    return meetings.map((m) => ({ label: m.title, hint: meetingWhen(m, latest.current.todayKey), run: () => void prepareMeeting(m) }))
  }, [prepareMeeting])

  const { take, clear } = inbox
  /** Alt+I: the tasks found in mail and calendar, as a proposal to accept (Enter) or drop (Esc). */
  const recoger = useCallback(async () => {
    const run = ++captureRun.current
    returnTo.current = document.activeElement as HTMLElement | null
    setSeed({ taskId: null, text: RECOGER, mode: 'changes' })
    setCapturing(true)
    present(RECOGER)
    try {
      const got = await take()
      if (run !== captureRun.current) return // closed meanwhile: what was found keeps waiting in the header
      if ('found' in got) {
        present(RECOGER, got.found)
        clear(got.found)
      } else {
        cancelAi()
        setCapturing(false)
        restoreFocus()
        notify(got.problem ?? 'Nada nuevo en tu correo, tu agenda ni tus reuniones')
      }
    } catch (error) {
      if (run === captureRun.current) fail(RECOGER, error)
    }
  }, [present, take, clear, cancelAi, fail, notify])
  const recogerReady = useRef(false)
  useEffect(() => {
    recogerReady.current = inbox.available
  }, [inbox.available])

  /** Alt+O: opens the mail or event a task came from. A real link, so it works inside claude.ai too. */
  const openSource = useCallback(() => {
    const id = activeTaskId()
    const url = latest.current.tasks.find((t) => t.id === id)?.source?.url
    if (!url) return false
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener'
    a.click()
    return true
  }, [])

  /**
   * Takes the cursor to a task from the plan. A filter or a collapsed parent
   * that hides it gives way, so the click always lands somewhere.
   */
  const openTask = useCallback(
    (id: string) => {
      if (view === 'board') {
        const card = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`)
        if (card) {
          card.focus()
          card.scrollIntoView({ block: 'nearest' })
          return
        }
      }
      const visible = view === 'list' && groups.some((g) => g.rows.some((r) => r.task.id === id && !r.dimmed))
      if (!visible) {
        const task = latest.current.tasks.find((t) => t.id === id)
        meaningRun.current?.abort()
        setMeaning('idle')
        setPrefs((p) => ({
          ...p,
          view: 'list',
          filters: { ...p.filters, tag: null, today: p.filters.today && task?.due != null && task.due <= todayKey, query: '', ids: null, hideDone: p.filters.hideDone && task?.status !== 'done' },
        }))
      }
      requestAnimationFrame(() => dispatch({ type: 'reveal', id }))
    },
    [view, groups, todayKey, setPrefs, dispatch],
  )
  /** Alt+J: the cursor to «Ahora». */
  const jumpToNow = useCallback(() => {
    const now = latest.current.steps.find((s) => s.state === 'now')
    if (now) openTask(now.task.id)
    return Boolean(now)
  }, [openTask])
  const clearPlan = useCallback(() => {
    const inside = document.activeElement?.closest('.plan')
    setPlan(null)
    notify('Plan del día quitado')
    // The × goes away with the plan: the cursor lands back on the sheet.
    if (inside) requestAnimationFrame(() => document.querySelector<HTMLElement>('textarea[data-task-text]')?.focus())
  }, [setPlan, notify])

  const extraActions = useCallback(
    (taskId: string): QuickItem[] => {
      const task = state.tasks.find((t) => t.id === taskId)
      const name = task?.text.trim()
      return [
        ...(inbox.available
          ? [{ label: RECOGER, hint: `${A}I`, keywords: 'ia ai correo gmail email agenda calendario calendar recoger bandeja invitaciones granola reuniones notas actas', run: () => void recoger() }]
          : []),
        ...(task?.source
          ? [{ label: 'Abrir el correo, evento o nota de origen', hint: `${A}O`, keywords: 'abrir origen correo gmail evento calendario granola nota reunion', run: () => {
              dispatch({ type: 'focus', id: taskId })
              requestAnimationFrame(() => openSource())
            } }]
          : []),
        ...(ai.available
          ? [
              ...(name
                ? [{ label: 'Dividir en pasos', hint: 'IA', keywords: 'ia ai split dividir descomponer subtareas pasos', run: () =>
                    openAi(taskId, `Divide en pasos la tarea seleccionada: «${name}»`, 'changes', `Dividir en pasos: ${name}`) }]
                : []),
              { label: 'Pedir a la IA…', hint: 'IA', keywords: 'ia ai pedir orden cambiar', run: () => openAi(taskId) },
              ...(name
                ? [{ label: 'Preparar borrador', hint: `${A}D`, keywords: 'ia ai borrador correo responder email redactar perseguir', run: () => void draftFor(taskId) }]
                : []),
              ...(inbox.available
                ? [{
                    label: 'Preparar reunión…',
                    keywords: 'ia ai reunion reunión meeting preparar agenda calendario',
                    list: { title: 'Preparar reunión', empty: 'No tienes reuniones hoy ni mañana', load: meetingItems },
                    run: () => {},
                  }]
                : []),
              { label: 'Planificar el día', hint: `${A}P`, keywords: 'ia ai plan planificar hoy prioridades', run: () => planDay(taskId) },
              { label: 'Redactar resumen del día', hint: `${A}⇧R`, keywords: 'ia ai resumen redactar standup correo', run: () => writeSummary(taskId) },
              ...(aiMode === 'key' && aiHasKey
                ? [{ label: 'Olvidar la clave de la IA', keywords: 'ia ai clave key anthropic borrar olvidar', searchOnly: true, run: () => {
                    forgetKey()
                    notify('Clave de la IA borrada de este navegador')
                    dispatch({ type: 'focus', id: taskId })
                  } }]
                : []),
            ]
          : []),
        ...(name
          ? [{
              label: plan?.ids.includes(taskId) ? 'Quitar del plan' : 'Añadir al plan',
              keywords: 'plan dia día hoy paso workflow ahora orden prioridad',
              run: () => {
                const { plan: next, full } = togglePlanned(plan, taskId, state.tasks, todayKey)
                if (full) notify(`El plan ya tiene ${MAX_STEPS} pasos`)
                else setPlan(next)
                dispatch({ type: 'focus', id: taskId })
              },
            }]
          : []),
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
        { label: 'Abrir la memoria', hint: `${A}M`, keywords: 'memoria wiki diario grafo panorama graficos historia', run: () => setMemory({ startTask: taskId }) },
        { label: 'Copiar resumen del día', hint: `${A}R`, keywords: 'resumen daily markdown portapapeles', run: () => { copySummary(); dispatch({ type: 'focus', id: taskId }) } },
        { label: 'Buscar', hint: `${M}F`, keywords: 'buscar filtrar search', run: () => setSearching(true) },
        { label: 'Exportar copia', hint: `${M}S`, keywords: 'backup json guardar descargar', run: exportAll },
        { label: 'Importar copia', hint: `${M}O`, keywords: 'backup json abrir cargar restaurar', run: openImport },
      ]
    },
    [state.tasks, templates, focusId, toggleFocusMode, saveTemplate, removeTemplate, notify, dispatch, copySummary, exportAll, openImport, ai.available, aiMode, aiHasKey, forgetKey, openAi, planDay, writeSummary, inbox.available, recoger, openSource, draftFor, meetingItems, plan, setPlan, todayKey],
  )

  const setView = useCallback((v: View) => setPrefs((p) => ({ ...p, view: v })), [setPrefs])

  // Hoy a cero: what's left for today, and one quiet moment when it reaches zero.
  const leftToday = shown.filter((t) => t.status !== 'done' && t.text.trim() && t.due !== null && t.due <= todayKey).length
  const doneToday = shown.some((t) => t.status === 'done' && t.completedAt !== null && dateKey(new Date(t.completedAt)) === todayKey)
  const prevLeft = useRef<number | null>(null)
  useEffect(() => {
    const before = prevLeft.current
    prevLeft.current = leftToday
    if (before && !leftToday && doneToday) setToast({ text: `Hoy, a cero · ${isMac ? '⌥' : 'Alt+'}R copia el resumen`, id: Date.now(), zero: true })
  }, [leftToday, doneToday])
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
          setSeed({ taskId: activeTaskId(), text: '', mode: 'changes' })
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
      } else if (e.altKey && e.code === 'KeyM') {
        e.preventDefault()
        const from = activeTaskId()
        setMemory((m) => (m ? null : { startTask: from }))
      } else if (e.altKey && (e.code === 'Digit1' || e.code === 'Digit2')) {
        e.preventDefault()
        setMemory(null)
        setView(e.code === 'Digit1' ? 'list' : 'board')
      } else if (e.altKey && e.code === 'KeyT') {
        e.preventDefault()
        setPrefs((p) => ({ ...p, filters: { ...p.filters, today: !p.filters.today } }))
      } else if (e.altKey && e.code === 'KeyF') {
        e.preventDefault()
        toggleFocusMode(activeTaskId())
      } else if (e.altKey && e.shiftKey && e.code === 'KeyR' && aiReady.current) {
        e.preventDefault()
        writeSummary(activeTaskId())
      } else if (e.altKey && e.code === 'KeyR') {
        e.preventDefault()
        copySummary()
      } else if (e.altKey && e.code === 'KeyD' && aiReady.current) {
        e.preventDefault()
        void draftFor(activeTaskId())
      } else if (e.altKey && e.code === 'KeyP' && aiReady.current) {
        e.preventDefault()
        planDay(activeTaskId())
      } else if (e.altKey && e.code === 'KeyJ') {
        if (jumpToNow()) e.preventDefault()
      } else if (e.altKey && e.code === 'KeyI' && recogerReady.current) {
        e.preventDefault()
        void recoger()
      } else if (e.altKey && e.code === 'KeyO') {
        if (openSource()) e.preventDefault()
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
  }, [dispatch, setView, setPrefs, exportAll, openImport, importFile, toggleFocusMode, copySummary, planDay, writeSummary, recoger, openSource, draftFor, jumpToNow])

  // Keep the heading right when the tab stays open past midnight.
  useEffect(() => {
    const timer = setInterval(() => setToday(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const open = shown.filter((t) => t.status !== 'done' && t.text.trim()).length
  const done = shown.filter((t) => t.status === 'done').length

  return (
    <TodayContext.Provider value={todayKey}>
      <NoticeContext.Provider value={notice}>
      <div className="app" data-view={view}>
        <header className="top">
          <div className="brand">Daily Tracking Tool</div>
          <div className="view-toggle" role="tablist" aria-label="Vista">
            {(['list', 'board'] as View[]).map((v, i) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v && !memory}
                title={`${v === 'list' ? 'Lista' : 'Tablero'} (${isMac ? '⌥' : 'Alt+'}${i + 1})`}
                onClick={(e) => {
                  setMemory(null)
                  setView(v)
                  if (e.detail > 0) teach(`view-${v}`, `${A}${i + 1}`)
                }}
              >
                {v === 'list' ? 'List' : 'Board'}
              </button>
            ))}
          </div>
          <div className="counts" aria-live="polite" title={`${plural(open, 'pendiente')} · ${plural(done, 'hecha')}`}>
            {inbox.count > 0 && (
              <>
                <button className="inbox-chip" title={`${RECOGER} (${isMac ? '⌥' : 'Alt+'}I)`} onClick={() => void recoger()}>
                  {inbox.count}
                  <span className="word">
                    {' '}
                    {!inbox.replies
                      ? `${inbox.count === 1 ? 'tarea' : 'tareas'} ${inbox.meetings === inbox.count ? 'de tus reuniones' : inbox.meetings ? 'por recoger' : 'en tu correo'}`
                      : inbox.replies === inbox.count
                        ? `${inbox.count === 1 ? 'respuesta' : 'respuestas'} en tu correo`
                        : 'novedades en tu correo'}
                  </span>
                </button>
                <span className="sep" />
              </>
            )}
            <span>{open}<span className="word"> {open === 1 ? 'pendiente' : 'pendientes'}</span></span>
            <span className="sep" />
            <span>{done}<span className="word"> {done === 1 ? 'hecha' : 'hechas'}</span></span>
          </div>
        </header>

        {memory ? (
          <Suspense fallback={<main className="sheet" />}>
            <MemoryView
              tasks={state.tasks}
              log={log}
              startTask={memory.startTask}
              onClose={() => setMemory(null)}
              onOpenTask={(id) => {
                const task = state.tasks.find((t) => t.id === id)
                setMemory(null)
                setFocusId(null)
                setPrefs((p) => ({
                  ...p,
                  view: 'list',
                  filters: { ...p.filters, tag: null, today: false, query: '', hideDone: p.filters.hideDone && task?.status !== 'done' },
                }))
                if (task?.snooze) setShowSnoozed(true)
                requestAnimationFrame(() => dispatch({ type: 'reveal', id }))
              }}
            />
          </Suspense>
        ) : (
        <>
        <main className="sheet">
          <div className="sheet-head">
            <h1 className="today">{todayFmt.format(today)}</h1>
            {searching && (
              <SearchBar
                query={filters.query}
                results={searchResults}
                onChange={setQuery}
                onClose={closeSearch}
                onEnter={jumpToFirstResult}
                meaning={ai.available ? { state: meaning, onAsk: searchByMeaning } : null}
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
              leftToday={leftToday}
              snoozed={snoozed}
              showSnoozed={showSnoozed}
              onShowSnoozed={() => setShowSnoozed(!showSnoozed)}
              onExitFocus={() => setFocusId(null)}
            />
            <PlanStrip steps={steps} onPick={openTask} onClear={clearPlan} />
          </div>

          {view === 'list' ? (
            <ListView
              state={listState}
              dispatch={dispatch}
              groups={groups}
              structural={sort === 'manual' && !filtering}
              grouped={sort !== 'manual'}
              activeTag={effective.tag}
              onTagClick={toggleTag}
              extraActions={extraActions}
              focused={focused}
              onSelection={setSelectedRows}
            />
          ) : (
            <BoardView tasks={shown} dispatch={dispatch} filters={effective} onTagClick={toggleTag} />
          )}
        </main>

        <KeysBar view={view} selected={view === 'list' ? selectedRows : 0} ai={ai.available} inbox={inbox.available} />
        </>
        )}

        {capturing && (
          <QuickCapture
            initialText={seed.text}
            pool={{ tags, people }}
            onCapture={(text) => {
              dispatch({ type: 'create', text, status: 'todo', inherit: inheritFromFilters(effective, todayKey) })
              setCapturing(false)
              notify(`Apuntada: ${parseTask(text).text || text.trim()}`)
              closeCapture()
            }}
            onClose={() => {
              setCapturing(false)
              closeCapture()
            }}
            ai={
              ai.available
                ? {
                    job: ai.job,
                    preview:
                      seed.mode === 'plan' && ai.job?.phase === 'proposal' ? (
                        <PlanStrip steps={planSteps(planFromPicks(ai.job.picks, ai.job.next, todayKey), ai.job.next, todayKey)} />
                      ) : null,
                    onAsk: (text) => {
                      const request = seed.request && text === seed.text ? seed.request : text
                      // What's typed after the «Borrador: …» label is the extra instruction, not the label itself.
                      if (seed.mode === 'draft') void draftFor(seed.taskId, true, (text.startsWith(seed.text) ? text.slice(seed.text.length) : text).trim())
                      else if (seed.mode === 'summary') openAi(seed.taskId, request, 'summary', text)
                      else void ai.ask(request, seed.taskId)
                    },
                    onCancel: ai.cancel,
                    onKey: ai.saveKey,
                    onAccept: () => {
                      const job = ai.job
                      if (job?.phase === 'text' && !job.text.trim()) {
                        // Nothing was written: there's nothing to copy.
                      } else if (job?.phase === 'text') {
                        const draft = seed.mode === 'draft'
                        const hasSource = draft && state.tasks.find((t) => t.id === seed.taskId)?.source
                        navigator.clipboard
                          ?.writeText(job.text)
                          .then(() => notify(draft ? `Borrador copiado${hasSource ? ` · ${isMac ? '⌥' : 'Alt+'}O abre el correo` : ''}` : 'Resumen copiado'))
                          .catch(() => notify(draft ? 'No se pudo copiar el borrador' : 'No se pudo copiar el resumen'))
                      } else if (job?.phase === 'proposal') {
                        // Another tab (or undo) changed the sheet meanwhile: applying would overwrite it.
                        if (job.base !== state.tasks) {
                          notify('La hoja ha cambiado. Vuelve a pedirlo con ' + (isMac ? '⌘↵' : 'Ctrl+↵'))
                          ai.cancel()
                          return
                        }
                        // Like a plain capture, what the AI adds keeps the active Hoy/tag filter, so it doesn't vanish on arrival.
                        const inherit = inheritFromFilters(effective, todayKey)
                        const before = new Set(job.base.map((t) => t.id))
                        const next = job.next.map((t) =>
                          before.has(t.id) ? t : { ...t, due: t.due ?? inherit.due ?? null, tags: [...new Set([...t.tags, ...(inherit.tags ?? [])])] },
                        )
                        dispatch({ type: 'apply', tasks: next })
                        if (seed.mode === 'plan') {
                          const made = planFromPicks(job.picks, next, todayKey)
                          if (made) setPlan(made)
                        }
                        notify(`${job.summary} · ${isMac ? '⌘' : 'Ctrl+'}Z deshace`)
                      } else return
                      ai.cancel()
                      setCapturing(false)
                      closeCapture()
                    },
                  }
                : null
            }
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
          <div key={toast.id} className="toast" data-zero={toast.zero || undefined} role="status">
            {toast.text}
          </div>
        )}
      </div>
      </NoticeContext.Provider>
    </TodayContext.Provider>
  )
}
