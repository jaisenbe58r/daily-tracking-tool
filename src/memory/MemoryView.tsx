import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { fold } from '../lib/parse'
import type { Task } from '../lib/types'
import { Balance, Bars, Estratos, Pulso, Trama } from './charts'
import {
  activeDay, addDays, buildMemory, chronology, day, dayOf, daysBetween, flight, longDay, median, monthName, pageFor, pageName,
  perWeek, related, shortDay, trama, tramaAll, yearDay, zeroDays, type Memory, type PageKey,
} from './graph'
import type { LogEvent } from './log'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
type Go = (key: PageKey) => void

interface Props {
  tasks: Task[]
  log: LogEvent[]
  /** The task the user was on: the memory opens on its project. */
  startTask: string | null
  onClose: () => void
  /** Back to the sheet, on that task. */
  onOpenTask: (id: string) => void
}

/**
 * Memoria (Alt+M): the sheet compiled into linked pages of projects, people,
 * topics and days, travelled with the keyboard. Read-only: the sheet is the
 * only place anything is written.
 */
export default function MemoryView({ tasks, log, startTask, onClose, onOpenTask }: Props) {
  const mem = useMemo(() => buildMemory(tasks, log), [tasks, log])
  const [page, setPage] = useState<PageKey>(() => pageFor(mem, startTask))
  const [trail, setTrail] = useState<PageKey[]>([])
  const [query, setQuery] = useState('')
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // A page whose subject disappeared from the sheet falls back to the overview.
  const exists = (k: PageKey) => k === 'panorama' || k === 'trama' || k.startsWith('d:') || mem.index.has(k)
  const current = exists(page) ? page : 'panorama'

  const go = useCallback<Go>(
    (k) => {
      if (k === current) return
      setTrail((t) => [...t, current])
      setPage(k)
      setQuery('')
      window.scrollTo({ top: 0 })
    },
    [current],
  )
  const back = useCallback((to?: number) => {
    setTrail((t) => {
      const i = to ?? t.length - 1
      if (i < 0 || !t[i]) return t
      setPage(t[i])
      return t.slice(0, i)
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inSearch = e.target === searchRef.current
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        back()
      } else if (e.key === 'Escape') {
        if (inSearch && query) setQuery('')
        else if (inSearch) searchRef.current?.blur()
        else onClose()
      } else if (inSearch || (e.target as HTMLElement | null)?.closest?.('input, textarea')) {
        return
      } else if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (current.startsWith('d:') && !e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        const next = addDays(current.slice(2), e.key === 'ArrowRight' ? 1 : -1)
        if (next <= mem.today) go(`d:${next}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back, current, go, mem.today, onClose, query])

  // Wide charts open on the latest weeks, where the reader starts.
  useEffect(() => {
    document.querySelectorAll<HTMLElement>('.memory .m-scroll').forEach((el) => (el.scrollLeft = el.scrollWidth))
  }, [current])

  const onMove = (e: MouseEvent) => {
    const el = (e.target as Element).closest?.('[data-tip]')
    setTip(el ? { text: el.getAttribute('data-tip')!, x: e.clientX, y: e.clientY } : null)
  }

  let body: ReactNode
  if (current === 'panorama') body = <Panorama mem={mem} go={go} open={onOpenTask} />
  else if (current === 'trama') body = <TramaPage mem={mem} go={go} />
  else if (current.startsWith('d:')) body = <DayPage mem={mem} d={current.slice(2)} go={go} open={onOpenTask} />
  else body = <EntityPage key={current} mem={mem} k={current} go={go} open={onOpenTask} />

  return (
    <div className="memory" onMouseMove={onMove} onMouseLeave={() => setTip(null)}>
      <div className="m-trail" aria-label="Recorrido">
        <span>Recorrido</span>
        {trail.slice(-5).map((k, i, shown) => (
          <span key={`${k}-${i}`} className="m-step">
            <span aria-hidden>›</span>
            <button type="button" onClick={() => back(trail.length - shown.length + i)}>{pageName(mem, k)}</button>
          </span>
        ))}
        <span className="m-step">
          <span aria-hidden>›</span>
          <span className="m-here">{pageName(mem, current)}</span>
        </span>
        <button type="button" className="m-close" onClick={onClose}>Volver al folio <kbd>Esc</kbd></button>
      </div>
      <div className="m-shell">
        <Index mem={mem} current={current} go={go} query={query} setQuery={setQuery} searchRef={searchRef} />
        <article className="m-page">{body}</article>
      </div>
      <footer className="hints" aria-hidden>
        <span><kbd>/</kbd> buscar</span>
        <span><kbd>←</kbd><kbd>→</kbd> días</span>
        <span><kbd>{isMac ? '⌥' : 'Alt+'}←</kbd> volver</span>
        <span><kbd>Esc</kbd> folio</span>
      </footer>
      {tip && (
        <div className="m-tip" style={{ left: Math.min(tip.x + 12, window.innerWidth - 272), top: tip.y > 60 ? tip.y - 44 : tip.y + 16 }}>
          {tip.text}
        </div>
      )}
    </div>
  )
}

// ── Index ───────────────────────────────────────────────

function Index({ mem, current, go, query, setQuery, searchRef }: {
  mem: Memory; current: PageKey; go: Go; query: string; setQuery: (q: string) => void; searchRef: React.RefObject<HTMLInputElement | null>
}) {
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 820)
  const q = fold(query.trim())
  const row = (k: PageKey, label: string, n?: ReactNode, id: string = k) => (
    <button key={id} type="button" className={`m-nl${k === current ? ' on' : ''}`} onClick={() => { go(k); if (window.innerWidth <= 820) setOpen(false) }}>
      <span>{label}</span>
      <span>{n}</span>
    </button>
  )
  const count = (k: PageKey) => mem.index.get(k)?.length ?? 0
  const pages: PageKey[] = [...mem.projects.map((p) => `p:${p.id}`), ...mem.people.map((h) => `h:${h}`), ...mem.tags.map((g) => `t:${g}`)]

  let list: ReactNode
  if (q) {
    const hits = pages.filter((k) => fold(pageName(mem, k)).includes(q))
    const seen = new Set<string>()
    const found = mem.tasks.filter((t) => fold(`${t.text} ${t.notes}`).includes(q) && !seen.has(t.text) && seen.add(t.text)).slice(0, 8)
    list = (
      <>
        <div className="m-navsec">
          <div className="m-eyebrow">Páginas</div>
          {hits.length ? hits.map((k) => row(k, pageName(mem, k), count(k))) : <span className="m-meta">Ninguna</span>}
        </div>
        <div className="m-navsec">
          <div className="m-eyebrow">Tareas</div>
          {found.length ? found.map((t) => row(`d:${activeDay(t)}`, t.text, shortDay(activeDay(t)), t.id)) : <span className="m-meta">Ninguna</span>}
        </div>
      </>
    )
  } else {
    list = (
      <>
        <div className="m-navsec">
          {row('panorama', 'Panorama')}
          {row('trama', 'Trama')}
          {row(`d:${mem.today}`, 'Diario de hoy', shortDay(mem.today))}
        </div>
        {mem.projects.length > 0 && (
          <div className="m-navsec">
            <div className="m-eyebrow">Proyectos</div>
            {mem.projects.map((p) => row(`p:${p.id}`, p.text.trim(), count(`p:${p.id}`)))}
          </div>
        )}
        {mem.people.length > 0 && (
          <div className="m-navsec">
            <div className="m-eyebrow">Personas</div>
            {mem.people.map((h) => row(`h:${h}`, pageName(mem, `h:${h}`), count(`h:${h}`)))}
          </div>
        )}
        {mem.tags.length > 0 && (
          <div className="m-navsec">
            <div className="m-eyebrow">Temas</div>
            {mem.tags.slice(0, 16).map((g) => row(`t:${g}`, `#${g}`, count(`t:${g}`)))}
          </div>
        )}
      </>
    )
  }

  return (
    <nav className="m-index" aria-label="Índice de la memoria">
      <button type="button" className="m-eyebrow m-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>Índice</button>
      <input
        ref={searchRef}
        id="memory-search"
        type="search"
        className="m-search"
        placeholder="Buscar en tu memoria"
        autoComplete="off"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          const first = e.currentTarget.parentElement?.querySelector<HTMLButtonElement>('.m-navsec .m-nl')
          first?.click()
          e.currentTarget.blur()
        }}
      />
      {open && list}
    </nav>
  )
}

// ── Pieces ──────────────────────────────────────────────

function PageLink({ mem, k, go, label }: { mem: Memory; k: PageKey; go: Go; label?: string }) {
  // A link, not a button, so it wraps and sits in a sentence like any word.
  return (
    <a href="#" className="m-lk" onClick={(e) => { e.preventDefault(); go(k) }}>
      {label ?? pageName(mem, k)}
    </a>
  )
}

function TaskLine({ mem, t, go, open, hide }: { mem: Memory; t: Task; go: Go; open: (id: string) => void; hide?: PageKey }) {
  const created = dayOf(t.createdAt)
  const bits: ReactNode[] = (mem.keys.get(t.id) ?? [])
    .filter((k) => k !== hide)
    .map((k) => <PageLink key={k} mem={mem} k={k} go={go} label={k.startsWith('h:') ? `@${pageName(mem, k)}` : undefined} />)
  bits.push(
    t.completedAt !== null ? (
      <span key="when">
        <PageLink mem={mem} k={`d:${created}`} go={go} /> → <PageLink mem={mem} k={`d:${dayOf(t.completedAt)}`} go={go} />
      </span>
    ) : (
      <span key="when">
        <PageLink mem={mem} k={`d:${created}`} go={go} /> · abierta {daysBetween(created, mem.today)} d
      </span>
    ),
  )
  return (
    <li className="m-t">
      <span className={`m-box ${t.status}`} aria-label={t.status === 'done' ? 'hecha' : t.status === 'doing' ? 'en curso' : 'pendiente'}>
        {t.status === 'done' ? '✓' : ''}
      </span>
      <span className="m-tx">
        <button type="button" className="m-open" title="Ir a la tarea en el folio" onClick={() => open(t.id)}>{t.text.trim()}</button>
        <span className="m-tm">
          {bits.map((b, i) => (
            <span key={i}>{i > 0 && ' · '}{b}</span>
          ))}
        </span>
      </span>
    </li>
  )
}

function TaskList({ mem, tasks, go, open, hide, limit = 8 }: { mem: Memory; tasks: Task[]; go: Go; open: (id: string) => void; hide?: PageKey; limit?: number }) {
  return (
    <>
      <ul className="m-tasks">{tasks.slice(0, limit).map((t) => <TaskLine key={t.id} mem={mem} t={t} go={go} open={open} hide={hide} />)}</ul>
      {tasks.length > limit && <div className="m-more">y {tasks.length - limit} más</div>}
    </>
  )
}

function H2({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return <h2 className="m-h2">{children}{note !== undefined && <small>{note}</small>}</h2>
}

// ── Project, person, topic ──────────────────────────────

function EntityPage({ mem, k, go, open }: { mem: Memory; k: PageKey; go: Go; open: (id: string) => void }) {
  const kind = k[0] as 'p' | 'h' | 't'
  const all = mem.index.get(k) ?? []
  const closed = all.filter((t) => t.completedAt !== null)
  const pending = all.filter((t) => t.status !== 'done').sort((a, b) => a.createdAt - b.createdAt)
  const first = all.reduce((m, t) => (dayOf(t.createdAt) < m ? dayOf(t.createdAt) : m), mem.today)
  const last = all.reduce((m, t) => (activeDay(t) > m ? activeDay(t) : m), first)
  const rel = related(mem, k, 99)
  const of = (prefix: string) => rel.filter(([x]) => x.startsWith(prefix))
  const topProjects = of('p:')
  const recent = closed.filter((t) => daysBetween(dayOf(t.completedAt!), mem.today) < 30).length

  const who = kind === 'h' ? 'con esta persona' : kind === 'p' ? 'en el proyecto' : 'con este tema'
  const where = topProjects.length ? <> Sobre todo en <PageLink mem={mem} k={topProjects[0][0]} go={go} />{topProjects[1] && <> y <PageLink mem={mem} k={topProjects[1][0]} go={go} /></>}.</> : null
  const summary = (
    <>
      Desde el {yearDay(first)}, {plural(all.length, 'tarea', 'tareas')}; {plural(recent, 'cerrada', 'cerradas')} en los últimos 30 días.
      {kind !== 'p' && where}{' '}
      {pending.length ? <>Quedan {plural(pending.length, 'cosa abierta', 'cosas abiertas')} {who}; la más antigua, «{pending[0].text.trim()}», es del <PageLink mem={mem} k={`d:${dayOf(pending[0].createdAt)}`} go={go} />.</> : <>No queda nada abierto {who}.</>}
    </>
  )

  const inline = (items: [PageKey, number][]) =>
    items.length ? (
      <div className="m-inline">
        {items.map(([x, n]) => (
          <span key={x}><PageLink mem={mem} k={x} go={go} label={x.startsWith('h:') ? `@${pageName(mem, x)}` : undefined} /><span className="m-n">{n}</span></span>
        ))}
      </div>
    ) : null

  return (
    <>
      <div className="m-eyebrow">{kind === 'p' ? 'Proyecto' : kind === 'h' ? 'Persona' : 'Tema'}</div>
      <h1 className="m-h1">{kind === 'h' ? `@${pageName(mem, k)}` : pageName(mem, k)}</h1>
      <div className="m-meta">
        {yearDay(first)} – {daysBetween(last, mem.today) <= 3 ? 'hoy' : yearDay(last)} · {plural(all.length, 'tarea', 'tareas')} · {plural(closed.length, 'cerrada', 'cerradas')} · vuelo mediano {median(closed.map(flight))} d
      </div>
      <p className="m-summary">{summary}</p>

      <H2 note="con quién y con qué se cruza, semana a semana">Trama</H2>
      <Trama mem={mem} rows={trama(mem, k)} go={go} />

      <H2 note={pending.length}>Abierto ahora</H2>
      {pending.length ? <TaskList mem={mem} tasks={pending} go={go} open={open} hide={kind === 'p' ? k : undefined} /> : <p className="m-meta">Nada abierto.</p>}

      {kind !== 'p' && topProjects.length > 0 && <><H2>Proyectos</H2>{inline(topProjects)}</>}
      {kind !== 'h' && of('h:').length > 0 && <><H2>Personas</H2>{inline(of('h:'))}</>}
      {of('t:').length > 0 && <><H2>Temas</H2>{inline(of('t:').slice(0, 12))}</>}

      <H2 note="lo que más destaca de cada mes">Cronología</H2>
      {chronology(mem, k).map((m) => (
        <div className="m-month" key={m.month}>
          <div className="m-mo">{monthName(m.month)}<span>{plural(m.closed, 'cerrada', 'cerradas')}</span></div>
          <ul>
            {m.highlights.map((t) => (
              <li key={t.id}>
                <span className="m-d">{shortDay(dayOf(t.completedAt!))}</span>
                <button type="button" className="m-open" onClick={() => open(t.id)}>{t.text.trim()}</button>
                {flight(t) >= 10 && <span className="m-meta"> tras {flight(t)} d</span>}
              </li>
            ))}
            {m.closed > m.highlights.length && <li className="m-more">y {m.closed - m.highlights.length} más</li>}
          </ul>
        </div>
      ))}
      {!closed.length && <p className="m-meta">Aún no hay nada cerrado.</p>}
    </>
  )
}

// ── Day ─────────────────────────────────────────────────

function DayPage({ mem, d, go, open }: { mem: Memory; d: string; go: Go; open: (id: string) => void }) {
  const today = d === mem.today
  const { closed, carried, started, snoozed, removed } = day(mem, d)
  const zero = zeroDays(mem).has(d)
  const touched = [...closed, ...carried]
  const counts = new Map<PageKey, number>()
  for (const t of touched) for (const k of mem.keys.get(t.id) ?? []) if (!k.startsWith('t:')) counts.set(k, (counts.get(k) ?? 0) + 1)
  const top = [...counts].sort((a, b) => b[1] - a[1])
  const topPage = top.find(([k]) => k.startsWith('p:'))
  const topPerson = top.find(([k]) => k.startsWith('h:'))
  const longest = [...closed].sort((a, b) => flight(b) - flight(a))[0]
  const weekday = longDay(d).split(' ')[0]

  const prose = touched.length ? (
    <>
      {weekday.charAt(0).toUpperCase() + weekday.slice(1)} con {[
        closed.length && plural(closed.length, 'cierre', 'cierres'),
        dayWritten(mem, d) && plural(dayWritten(mem, d), 'tarea escrita', 'tareas escritas'),
      ].filter(Boolean).join(' y ') || 'tareas abiertas en marcha'}.
      {topPage && <> El día giró alrededor de <PageLink mem={mem} k={topPage[0]} go={go} />{topPerson && <>, con <PageLink mem={mem} k={topPerson[0]} go={go} label={`@${pageName(mem, topPerson[0])}`} /></>}.</>}
      {!topPage && topPerson && <> Quien más apareció fue <PageLink mem={mem} k={topPerson[0]} go={go} label={`@${pageName(mem, topPerson[0])}`} />.</>}
      {longest && flight(longest) >= 5 && <> Cerraste «{longest.text.trim()}», que llevaba {flight(longest)} días abierta.</>}
      {zero && ' Terminó a cero.'}
    </>
  ) : (
    'Nada se movió en el folio este día.'
  )

  return (
    <>
      <div className="m-eyebrow">Diario</div>
      <h1 className="m-h1">{longDay(d)}{zero && <span className="m-zero">A cero</span>}</h1>
      <div className="m-meta">
        {plural(closed.length, 'cerrada', 'cerradas')} · {plural(dayWritten(mem, d), 'escrita', 'escritas')} · {today ? 'hoy' : `hace ${plural(daysBetween(d, mem.today), 'día', 'días')}`}
      </div>
      <p className="m-diary">{prose}</p>
      {closed.length > 0 && <><H2 note={closed.length}>Cerradas</H2><TaskList mem={mem} tasks={closed} go={go} open={open} limit={50} /></>}
      {started.length > 0 && <><H2 note={started.length}>Empezadas</H2><TaskList mem={mem} tasks={started} go={go} open={open} limit={50} /></>}
      {carried.length > 0 && <><H2 note={carried.length}>Escritas y que siguieron</H2><TaskList mem={mem} tasks={carried} go={go} open={open} limit={50} /></>}
      {snoozed.length > 0 && <><H2 note={snoozed.length}>Pospuestas</H2><TaskList mem={mem} tasks={snoozed} go={go} open={open} limit={50} /></>}
      {removed.length > 0 && <><H2 note={removed.length}>Borradas</H2><ul className="m-gone">{removed.map((r, i) => <li key={i}>{r}</li>)}</ul></>}
      <div className="m-daynav">
        <button type="button" onClick={() => go(`d:${addDays(d, -1)}`)}>← {shortDay(addDays(d, -1))}</button>
        {!today && <button type="button" onClick={() => go(`d:${addDays(d, 1)}`)}>{shortDay(addDays(d, 1))} →</button>}
      </div>
    </>
  )
}

const dayWritten = (mem: Memory, d: string) => mem.tasks.filter((t) => dayOf(t.createdAt) === d).length

// ── Trama ───────────────────────────────────────────────

function TramaPage({ mem, go }: { mem: Memory; go: Go }) {
  const rows = tramaAll(mem)
  return (
    <>
      <div className="m-eyebrow">Trama · desde el {shortDay(mem.weeks[0])}</div>
      <h1 className="m-h1">Con quién y con qué, semana a semana</h1>
      <p className="m-q">Cada fila es un proyecto, una persona o un tema; cada columna, una semana. Pulsa una fila para ir a su página o una celda para ir a ese día. Cada página tiene su propia Trama con lo que se cruza con ella.</p>
      {rows.length > 1 ? <Trama mem={mem} rows={rows} go={go} /> : <p className="m-meta">Aún no hay proyectos (tareas con dos o más subtareas), <code>@personas</code> ni <code>#temas</code> que cruzar.</p>}
    </>
  )
}

// ── Panorama ────────────────────────────────────────────

function Panorama({ mem, go, open }: { mem: Memory; go: Go; open: (id: string) => void }) {
  const closed = mem.work.filter((t) => t.completedAt !== null)
  if (!mem.tasks.length) {
    return (
      <>
        <div className="m-eyebrow">Panorama</div>
        <h1 className="m-h1">Tu memoria empieza aquí</h1>
        <p className="m-summary">Se escribe sola a medida que capturas y cierras tareas: cada tarea con subtareas se vuelve un proyecto, cada <code>#tema</code> y cada <code>@persona</code> una página, y cada día una entrada de diario.</p>
      </>
    )
  }
  const zero = zeroDays(mem)
  const closedOn = new Map<string, number>()
  for (const t of closed) closedOn.set(dayOf(t.completedAt!), (closedOn.get(dayOf(t.completedAt!)) ?? 0) + 1)
  const med = median(closed.map(flight))
  const inRange = (d: string) => d >= mem.weeks[0]
  const zeros = [...zero].filter(inRange).length

  const loose = mem.work.filter((t) => !mem.keys.get(t.id)?.some((k) => k.startsWith('p:')))
  const strata = [
    ...mem.projects.slice(0, 8).map((p) => ({ key: `p:${p.id}`, label: p.text.trim(), counts: perWeek(mem, mem.index.get(`p:${p.id}`) ?? [], doneDay) })),
    ...(loose.length ? [{ key: '', label: 'Sin proyecto', counts: perWeek(mem, loose, doneDay) }] : []),
  ].filter((r) => r.counts.some(Boolean))

  const FLIGHT: [string, number, number][] = [['mismo día', 0, 0], ['1 d', 1, 1], ['2–3 d', 2, 3], ['4–7 d', 4, 7], ['8–14 d', 8, 14], ['15–30 d', 15, 30], ['> 30 d', 31, Infinity]]
  const flights = FLIGHT.map(([label, a, b]) => ({ label, n: closed.filter((t) => flight(t) >= a && flight(t) <= b).length, hi: med >= a && med <= b }))
  const quick = closed.length ? Math.round((100 * (flights[0].n + flights[1].n)) / closed.length) : 0

  const pending = mem.work.filter((t) => t.status !== 'done')
  const age = (t: Task) => daysBetween(dayOf(t.createdAt), mem.today)
  const AGE: [string, number, number][] = [['< 3 d', 0, 2], ['3–7 d', 3, 7], ['8–30 d', 8, 30], ['31–90 d', 31, 90], ['> 90 d', 91, Infinity]]
  const drift = AGE.map(([label, a, b], i) => ({ label, n: pending.filter((t) => age(t) >= a && age(t) <= b).length, hi: i >= 3 }))
  const oldest = [...pending].sort((a, b) => a.createdAt - b.createdAt).slice(0, 3)

  return (
    <>
      <div className="m-eyebrow">Panorama · desde el {shortDay(mem.weeks[0])}</div>
      <h1 className="m-h1">Cómo estás trabajando</h1>
      <div className="m-tiles">
        <div className="m-tile"><div className="m-eyebrow">Cerradas</div><div className="m-v">{closed.filter((t) => inRange(dayOf(t.completedAt!))).length}</div><div className="m-s">de {mem.work.filter((t) => inRange(dayOf(t.createdAt))).length} escritas</div></div>
        <div className="m-tile"><div className="m-eyebrow">Vuelo mediano</div><div className="m-v">{med} d</div><div className="m-s">de escribir a cerrar</div></div>
        <div className="m-tile"><div className="m-eyebrow">Días a cero</div><div><span className={`m-v${zeros ? ' m-g' : ''}`}>{zeros}</span></div><div className="m-s">sin nada planificado pendiente</div></div>
      </div>

      <H2>Pulso</H2>
      <p className="m-q">¿Qué días rindes? Un cuadro por día; más oscuro, más cierres. En verde, los días a cero.</p>
      <Pulso mem={mem} closedOn={closedOn} zero={zero} go={go} />

      {strata.length > 0 && (
        <>
          <H2>Estratos</H2>
          <p className="m-q">¿Dónde se va el tiempo? Cierres por semana en cada proyecto, en la misma escala.</p>
          <Estratos mem={mem} rows={strata} go={go} />
        </>
      )}

      {closed.length > 0 && (
        <>
          <H2>Vuelo</H2>
          <p className="m-q">¿Cuánto tardas en cerrar lo que escribes?</p>
          <Bars items={flights} unit="tareas cerradas" />
          <p className="m-meta m-after">El {quick}% se cierra en un día o menos. En negro, el tramo de la mediana.</p>
        </>
      )}

      {pending.length > 0 && (
        <>
          <H2>Deriva</H2>
          <p className="m-q">¿Qué se está quedando atrás? Tareas abiertas según su edad.</p>
          <Bars items={drift} unit="tareas abiertas" />
          <p className="m-meta m-after">En negro, lo que lleva más de un mes. Las más antiguas:</p>
          <TaskList mem={mem} tasks={oldest} go={go} open={open} />
        </>
      )}

      <H2>Balance</H2>
      <p className="m-q">¿La lista crece o baja? Cierres menos tareas escritas, por semana.</p>
      <Balance mem={mem} closed={perWeek(mem, closed, doneDay)} written={perWeek(mem, mem.work, (t) => dayOf(t.createdAt))} />
    </>
  )
}

const doneDay = (t: Task) => (t.completedAt === null ? null : dayOf(t.completedAt))
