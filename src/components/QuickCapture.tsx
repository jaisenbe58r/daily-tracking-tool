import { useLayoutEffect, useRef, useState } from 'react'
import type { AiJob } from '../ai/useAi'
import type { Change } from '../ai/ops'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const M = isMac ? '⌘' : 'Ctrl'

export interface AiControls {
  job: AiJob | null
  onAsk: (text: string) => void
  onApply: () => void
  onCancel: () => void
}

interface Props {
  onCapture: (text: string) => void
  onClose: () => void
  /** Present only when an AI runtime answered; otherwise capture is local only. */
  ai?: AiControls | null
  initialText?: string
}

/**
 * Cmd/Ctrl+K from anywhere: one floating line, Enter saves, and focus goes back
 * to where it was. The capture grammar (#tag, !, mañana) applies here too.
 * With AI, Cmd/Ctrl+Enter sends the line to the agent instead and the answer
 * comes back as a preview under the line: Enter applies it, Esc drops it.
 */
export function QuickCapture({ onCapture, onClose, ai, initialText = '' }: Props) {
  const [text, setText] = useState(initialText)
  const inputRef = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => inputRef.current?.focus(), [])
  const job = ai?.job ?? null

  const close = () => {
    ai?.onCancel()
    onClose()
  }

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
          onChange={(e) => {
            setText(e.target.value)
            // Editing the request drops the answer to the old one.
            if (job) ai?.onCancel()
          }}
          onKeyDown={(e) => {
            const mod = isMac ? e.metaKey : e.ctrlKey
            if (e.key === 'Enter' && mod && ai && text.trim()) {
              e.preventDefault()
              ai.onAsk(text.trim())
            } else if (e.key === 'Enter' && job?.phase === 'proposal') {
              e.preventDefault()
              if (job.changes.length) ai?.onApply()
              else close()
            } else if (e.key === 'Enter' && !job && text.trim()) {
              e.preventDefault()
              onCapture(text)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              close()
            }
          }}
        />
        {ai && !job && text.trim() ? (
          <span className="capture-keys"><kbd>↵</kbd><kbd>{M}↵</kbd><span className="capture-ai">IA</span></span>
        ) : (
          !job && <kbd>↵</kbd>
        )}
        {job && <AiPanel job={job} />}
      </div>
    </div>
  )
}

function AiPanel({ job }: { job: AiJob }) {
  if (job.phase === 'thinking') {
    return (
      <div className="capture-panel" role="status" aria-live="polite">
        <span className="ai-thinking">Pensando</span>
        <span className="capture-foot"><kbd>esc</kbd> cancelar</span>
      </div>
    )
  }
  if (job.phase === 'error') {
    return (
      <div className="capture-panel" role="alert">
        <span className="ai-summary">{job.message}</span>
        <span className="capture-foot"><kbd>{M}↵</kbd> reintentar <kbd>esc</kbd> cerrar</span>
      </div>
    )
  }
  return (
    <div className="capture-panel" role="status" aria-live="polite">
      <span className="ai-summary">{job.summary}</span>
      {job.changes.length > 0 && (
        <ul className="ai-changes">
          {job.changes.map((c, i) => (
            <ChangeLine key={i} change={c} />
          ))}
        </ul>
      )}
      <span className="capture-foot">
        {job.changes.length ? <><kbd>↵</kbd> aplicar <kbd>esc</kbd> descartar</> : <><kbd>esc</kbd> cerrar</>}
      </span>
    </div>
  )
}

const MARK: Record<Change['kind'], string> = { add: '+', update: '~', done: '✓', move: '→', remove: '−' }

function ChangeLine({ change }: { change: Change }) {
  const detail = 'detail' in change ? change.detail : ''
  return (
    <li className="ai-change" data-kind={change.kind} style={change.kind === 'add' ? { paddingLeft: change.depth * 20 } : undefined}>
      <span className="ai-mark" aria-hidden>{MARK[change.kind]}</span>
      <span className="ai-text">{change.text}</span>
      {detail && <span className="ai-detail">{detail}</span>}
    </li>
  )
}
