import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AiJob } from '../ai/useAi'
import type { Change } from '../ai/ops'
import { dictation, type Dictation } from '../ai/voice'
import { complete, suggestions, tokenAt } from '../lib/suggest'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const M = isMac ? '⌘' : 'Ctrl'

export interface AiControls {
  job: AiJob | null
  onAsk: (text: string) => void
  /** Enter on an answer: apply a proposal, copy a text. */
  onAccept: () => void
  onCancel: () => void
  /** Key mode: the user's Anthropic key, typed once when the panel asks for it. */
  onKey: (key: string) => void
}

interface Props {
  onCapture: (text: string) => void
  onClose: () => void
  /** Present only when an AI runtime answered; otherwise capture is local only. */
  ai?: AiControls | null
  initialText?: string
  /** Tags and people already in the sheet, offered as you type `#` or `@`. */
  pool?: { tags: string[]; people: string[] }
}

/**
 * Cmd/Ctrl+K from anywhere: one floating line, Enter saves, and focus goes back
 * to where it was. The capture grammar (#tag, !, mañana) applies here too.
 * With AI, Cmd/Ctrl+Enter (or tapping «IA») sends the line to the agent
 * instead and the answer comes back as a preview under the line, growing as
 * it streams: Enter applies it, Esc drops it.
 */
export function QuickCapture({ onCapture, onClose, ai, initialText = '', pool }: Props) {
  const [text, setText] = useState(initialText)
  const [listening, setListening] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const mic = useRef<Dictation | null>(null)
  useLayoutEffect(() => inputRef.current?.focus(), [])
  useEffect(() => () => mic.current?.stop(), [])
  const job = ai?.job ?? null
  const canDictate = typeof window !== 'undefined' && dictation.supported()

  // Autocomplete for the #tag or @name at the caret.
  const [caret, setCaret] = useState(initialText.length)
  const [pick, setPick] = useState(0)
  const [hidden, setHidden] = useState<number | null>(null)
  const token = pool && !ai?.job ? tokenAt(text, caret) : null
  const words = token && hidden !== token.start ? suggestions(token, pool!) : []
  const chosen = Math.min(pick, Math.max(words.length - 1, 0))
  const accept = (word: string) => {
    if (!token) return
    const next = complete(text, token, caret, word)
    setText(next.text)
    setCaret(next.caret)
    setPick(0)
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(next.caret, next.caret))
  }

  const close = () => {
    mic.current?.stop()
    ai?.onCancel()
    onClose()
  }
  const askAi = () => {
    if (!ai || !text.trim()) return
    mic.current?.stop()
    ai.onAsk(text.trim())
    inputRef.current?.focus()
  }
  const acceptAnswer = () => {
    if (job?.phase === 'proposal' && !job.changes.length) close()
    else ai?.onAccept()
  }
  const toggleMic = () => {
    if (mic.current) {
      mic.current.stop()
      return
    }
    // Dictation adds to what's already typed, so a thought can be spoken in pieces.
    const before = text.trim()
    mic.current = dictation.start({
      onText: (heard) => {
        setText(before ? `${before} ${heard}` : heard)
        if (job) ai?.onCancel()
      },
      onEnd: () => {
        mic.current = null
        setListening(false)
        inputRef.current?.focus()
      },
    })
    setListening(Boolean(mic.current))
  }

  const answered = job?.phase === 'proposal' || job?.phase === 'text'

  return (
    <div className="qa-backdrop capture-backdrop" onPointerDown={close}>
      <div className="capture" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Capturar tarea">
        <span className="capture-check" aria-hidden />
        <input
          ref={inputRef}
          id="quick-capture"
          className="capture-input"
          value={text}
          placeholder={ai ? `Apunta una tarea…   o pídeselo a la IA con ${M}↵` : 'Apunta una tarea…   #tag   !   mañana'}
          autoComplete="off"
          enterKeyHint={answered ? 'done' : 'enter'}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onChange={(e) => {
            setText(e.target.value)
            setCaret(e.target.selectionStart ?? e.target.value.length)
            setPick(0)
            // Editing the request drops the answer to the old one.
            if (job) ai?.onCancel()
          }}
          onKeyDown={(e) => {
            const mod = isMac ? e.metaKey : e.ctrlKey
            if (words.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault()
              setPick((chosen + (e.key === 'ArrowDown' ? 1 : -1) + words.length) % words.length)
            } else if (words.length && (e.key === 'Tab' || (e.key === 'Enter' && !mod && token!.prefix))) {
              e.preventDefault()
              accept(words[chosen])
            } else if (words.length && e.key === 'Escape') {
              e.preventDefault()
              setHidden(token!.start)
            } else if (e.key === 'Enter' && mod && ai && text.trim()) {
              e.preventDefault()
              askAi()
            } else if (e.key === 'Enter' && answered) {
              e.preventDefault()
              acceptAnswer()
            } else if (e.key === 'Enter' && !job && text.trim()) {
              e.preventDefault()
              mic.current?.stop()
              onCapture(text)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              close()
            } else if (e.altKey && e.code === 'KeyV' && canDictate) {
              e.preventDefault()
              toggleMic()
            }
          }}
        />
        {canDictate && (
          <button
            type="button"
            className="capture-mic"
            aria-pressed={listening}
            aria-label={listening ? 'Parar el dictado' : 'Dictar'}
            title={`Dictar (${isMac ? '⌥' : 'Alt+'}V)`}
            onClick={toggleMic}
          >
            <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden>
              <rect x="3.5" y="0.75" width="5" height="8" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M1.5 6.5a4.5 4.5 0 0 0 9 0M6 11v2.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        )}
        {ai && !job && text.trim() ? (
          <span className="capture-keys">
            <kbd>↵</kbd>
            {/* A button too, so the AI is reachable on touch screens with no Cmd/Ctrl key. */}
            <button type="button" className="capture-ai" onClick={askAi} title={`Pedírselo a la IA (${M}↵)`}>
              <kbd>{M}↵</kbd> IA
            </button>
          </span>
        ) : (
          !job && <kbd>↵</kbd>
        )}
        {words.length > 0 && (
          <ul className="capture-panel suggest" role="listbox" aria-label={token!.kind === '#' ? 'Tags' : 'Personas y fechas'}>
            {words.map((w, i) => (
              <li
                key={w}
                role="option"
                aria-selected={i === chosen}
                className="qa-item"
                onPointerDown={(e) => { e.preventDefault(); accept(w) }}
                onPointerMove={() => setPick(i)}
              >
                <span>{token!.kind}{w}</span>
                {i === chosen && <kbd>Tab</kbd>}
              </li>
            ))}
          </ul>
        )}
        {job && (
          <AiPanel
            job={job}
            onAccept={acceptAnswer}
            onClose={close}
            onRetry={askAi}
            onKey={(key) => {
              ai?.onKey(key)
              // The key field goes away; Enter and Esc work on the line again, as for any answer.
              inputRef.current?.focus()
            }}
          />
        )}
      </div>
    </div>
  )
}

interface PanelProps {
  job: AiJob
  onAccept: () => void
  onClose: () => void
  onRetry: () => void
  onKey: (key: string) => void
}

function AiPanel({ job, onAccept, onClose, onRetry, onKey }: PanelProps) {
  const esc = (label: string) => (
    <button type="button" className="capture-act" onClick={onClose}>
      <kbd>esc</kbd> {label}
    </button>
  )
  if (job.phase === 'thinking') {
    return (
      <div className="capture-panel" role="status" aria-live="polite">
        <span className="ai-thinking">Pensando</span>
        {job.changes && <Changes changes={job.changes} />}
        {job.text && <p className="ai-prose">{job.text}</p>}
        <span className="capture-foot">{esc('cancelar')}</span>
      </div>
    )
  }
  if (job.phase === 'key') return <KeyPrompt invalid={job.invalid} onKey={onKey} onClose={onClose} />
  if (job.phase === 'error') {
    return (
      <div className="capture-panel" role="alert">
        <span className="ai-summary">{job.message}</span>
        <span className="capture-foot">
          <button type="button" className="capture-act" onClick={onRetry}>
            <kbd>{M}↵</kbd> reintentar
          </button>
          {esc('cerrar')}
        </span>
      </div>
    )
  }
  if (job.phase === 'text' && !job.text.trim()) {
    // The model may write nothing on purpose: the task isn't a mail to send.
    return (
      <div className="capture-panel" role="status" aria-live="polite">
        <span className="ai-summary">Nada que redactar: esta tarea no parece un correo</span>
        <span className="capture-foot">{esc('cerrar')}</span>
      </div>
    )
  }
  if (job.phase === 'text') {
    return (
      <div className="capture-panel" role="status" aria-live="polite">
        <p className="ai-prose">{job.text}</p>
        <span className="capture-foot">
          <button type="button" className="capture-act" onClick={onAccept}>
            <kbd>↵</kbd> copiar
          </button>
          {esc('cerrar')}
        </span>
      </div>
    )
  }
  return (
    <div className="capture-panel" role="status" aria-live="polite">
      <span className="ai-summary">{job.summary}</span>
      {job.changes.length > 0 && <Changes changes={job.changes} />}
      <span className="capture-foot">
        {job.changes.length > 0 && (
          <button type="button" className="capture-act" onClick={onAccept}>
            <kbd>↵</kbd> aplicar
          </button>
        )}
        {esc(job.changes.length ? 'descartar' : 'cerrar')}
      </span>
    </div>
  )
}

/**
 * Asked once, where the answer would appear: paste the key, Enter. It stays
 * in this browser (localStorage) and only ever goes to Anthropic.
 */
function KeyPrompt({ invalid, onKey, onClose }: { invalid: boolean; onKey: (key: string) => void; onClose: () => void }) {
  const [key, setKey] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => ref.current?.focus(), [])
  const save = () => key.trim() && onKey(key.trim())
  return (
    <div className="capture-panel" role="group" aria-label="Clave de Anthropic">
      <span className="ai-summary">
        {invalid ? 'Anthropic no acepta esa clave. Prueba con otra.' : 'Pega tu clave de Anthropic. Se guarda solo en este navegador.'}
      </span>
      <input
        ref={ref}
        className="ai-key"
        type="password"
        value={key}
        placeholder="sk-ant-…"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <span className="capture-foot">
        <button type="button" className="capture-act" onClick={save}>
          <kbd>↵</kbd> guardar
        </button>
        <button type="button" className="capture-act" onClick={onClose}>
          <kbd>esc</kbd> cerrar
        </button>
      </span>
    </div>
  )
}

const MARK: Record<Change['kind'], string> = { add: '+', update: '~', done: '✓', move: '→', remove: '−' }

function Changes({ changes }: { changes: Change[] }) {
  return (
    <ul className="ai-changes">
      {changes.map((c, i) => {
        const detail = 'detail' in c ? c.detail : ''
        return (
          <li key={i} className="ai-change" data-kind={c.kind} style={c.kind === 'add' ? { paddingLeft: c.depth * 20 } : undefined}>
            <span className="ai-mark" aria-hidden>{MARK[c.kind]}</span>
            <span className="ai-text">{c.text}</span>
            {detail && <span className="ai-detail">{detail}</span>}
          </li>
        )
      })}
    </ul>
  )
}
