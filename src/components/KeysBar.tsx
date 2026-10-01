import { useEffect, useState } from 'react'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const M = isMac ? '⌘' : 'Ctrl+'
const A = isMac ? '⌥' : 'Alt+'
const S = isMac ? '⇧' : 'Shift+'

type Key = [keys: string, what: string]

interface Props {
  view: 'list' | 'board'
  /** Rows selected in the list (Shift+↑/↓). */
  selected: number
  ai: boolean
  inbox: boolean
}

/** The whole keyboard, grouped the way the work goes: write, move, execute, ask, look. */
function allKeys({ ai, inbox }: Pick<Props, 'ai' | 'inbox'>): [string, Key[]][] {
  return [
    ['Escribir', [
      ['↵', 'nueva tarea'],
      ['Tab', 'subtarea'],
      [`${S}Tab`, 'subir nivel'],
      [`${S}↵`, 'nota'],
      ['#', 'tag al escribir'],
      ['!', 'prioridad'],
      ['mañana', 'fecha al final'],
      ['@', 'persona o fecha'],
      [`${M}K`, 'captura rápida'],
      [`${M}Z`, 'deshacer'],
    ]],
    ['Organizar', [
      ['/', 'acciones de la tarea'],
      ['↑ ↓', 'moverse'],
      [`${A}${S}↑ ↓`, 'mover la tarea'],
      [`${M}.`, 'plegar hijos'],
      [`${S}↑ ↓`, 'seleccionar varias'],
      [`${M}${S}⌫`, 'borrar la tarea'],
      [`${M}F`, 'buscar'],
    ]],
    ['Ejecutar', [
      [`${M}↵`, 'completar'],
      [`${A}H`, 'para hoy'],
      [`${A}T`, 'vista Hoy'],
      [`${A}L`, 'posponer'],
      [`${A}U`, 'subrayar (==frase==)'],
      [`${A}F`, 'modo foco'],
      [`${A}J`, 'ir a «Ahora» del plan'],
      [`${A}R`, 'copiar resumen'],
    ]],
    ...(ai || inbox
      ? [['IA y correo', [
          ...(ai ? ([[`${M}K ${M}↵`, 'pedir a la IA'], [`${A}P`, 'plan del día'], [`${A}D`, 'borrador'], [`${A}G`, 'borrador a Gmail'], [`${A}${S}R`, 'resumen redactado']] as Key[]) : []),
          ...(inbox ? ([[`${A}I`, 'recoger correo y agenda'], [`${A}O`, 'abrir el origen']] as Key[]) : []),
        ]] as [string, Key[]]]
      : []),
    ['Ver', [
      [`${A}1 ${A}2`, 'lista, board'],
      [`${A}M`, 'memoria'],
      [`${M}S ${M}O`, 'copia JSON'],
      ['?', 'esta lista'],
    ]],
  ]
}

/**
 * The keys at the foot of the page: the few that matter right now, and every
 * other one a click (or "?") away.
 */
export function KeysBar({ view, selected, ai, inbox }: Props) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing = !!el && el.matches('input, textarea, select, [contenteditable="true"]')
      if (e.key === '?' && !typing) { e.preventDefault(); setOpen((o) => !o) }
      else if (e.key === 'Escape' && open) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const now: Key[] = selected
    ? [[`${selected}`, selected === 1 ? 'seleccionada' : 'seleccionadas'], ['⌫', 'borrar'], [`${M}↵`, 'completar'], [`${S}↑ ↓`, 'ampliar'], ['Esc', 'salir']]
    : view === 'board'
      ? [['← →', 'cambiar columna'], ['↑ ↓', 'moverse'], ['↵', 'editar'], [`${M}↵`, 'completar'], [`${M}⌫`, 'borrar'], [`${M}K`, 'capturar'], [`${A}1`, 'lista']]
      : [['↵', 'nueva'], ['Tab', 'subtarea'], [`${M}↵`, 'completar'], ['/', 'acciones'], [`${S}↑ ↓`, 'seleccionar'], [`${M}${S}⌫`, 'borrar'], [`${M}K`, 'capturar'], [`${M}F`, 'buscar'], [`${A}H`, 'hoy'], [`${A}M`, 'memoria']]

  return (
    <footer className="hints" data-selecting={selected ? true : undefined}>
      {open && (
        <div className="keys-all" role="dialog" aria-label="Todos los atajos">
          {allKeys({ ai, inbox }).map(([title, keys]) => (
            <section key={title}>
              <h3>{title}</h3>
              {keys.map(([k, what]) => (
                <div key={k + what} className="keys-row"><kbd>{k}</kbd><span>{what}</span></div>
              ))}
            </section>
          ))}
        </div>
      )}
      <div className="keys-now" aria-hidden={!selected}>
        {now.map(([k, what]) => (
          <span key={k + what}><kbd>{k}</kbd> {what}</span>
        ))}
        <button type="button" className="keys-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Cerrar' : 'Todos'} <kbd>?</kbd>
        </button>
      </div>
    </footer>
  )
}
