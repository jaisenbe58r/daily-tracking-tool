import { useLayoutEffect, useRef, useState } from 'react'
import type { Task } from '../lib/types'
import { githubProblem, issueBody, parseRepo, refOf, repoFor, shortRef, type IssueRef } from './link'

export type GithubJob = { kind: 'create'; task: Task; tasks: Task[] } | { kind: 'close'; task: Task }

interface Props {
  job: GithubJob
  /** Creates the issue; resolves to its link. */
  onCreate: (owner: string, repo: string, title: string, body: string) => Promise<{ ref: IssueRef; url: string }>
  onClose: (ref: IssueRef) => Promise<void>
  /** Done: what to say in the toast. */
  onDone: (job: GithubJob, created?: { ref: IssueRef; url: string; repo: string }) => void
  onCancel: () => void
}

/**
 * Alt+G: the issue a task would become, shown before anything is sent. The
 * line holds the repository (remembered per tag); Enter creates, Esc drops.
 * On a done task with a linked issue, the same key offers to close it.
 */
export function GithubLine({ job, onCreate, onClose, onDone, onCancel }: Props) {
  const [repo, setRepo] = useState(() => (job.kind === 'create' ? repoFor(job.task) : ''))
  const [state, setState] = useState<{ phase: 'ready' | 'sending' } | { phase: 'error'; message: string }>({ phase: 'ready' })
  const inputRef = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => inputRef.current?.focus(), [])

  const title = job.task.text.trim()
  const body = job.kind === 'create' ? issueBody(job.tasks, job.task.id) : ''
  const target = job.kind === 'create' ? parseRepo(repo) : null
  const ref = job.kind === 'close' ? refOf(job.task.source) : null

  const go = async () => {
    if (state.phase === 'sending') return
    if (job.kind === 'create' && !target) {
      setState({ phase: 'error', message: 'Escribe el repositorio como owner/repo' })
      return
    }
    setState({ phase: 'sending' })
    try {
      if (job.kind === 'create' && target) {
        const created = await onCreate(target.owner, target.repo, title, body)
        onDone(job, { ...created, repo: `${target.owner}/${target.repo}` })
      } else if (ref) {
        await onClose(ref)
        onDone(job)
      }
    } catch (error) {
      setState({ phase: 'error', message: githubProblem(error) })
    }
  }

  return (
    <div className="qa-backdrop capture-backdrop" onPointerDown={onCancel}>
      <div className="capture" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Llevar a GitHub">
        <span className="capture-check" aria-hidden />
        <input
          ref={inputRef}
          id="github-repo"
          className="capture-input"
          value={job.kind === 'create' ? repo : `Cerrar ${job.task.source ? shortRef(job.task.source) : ''} en GitHub`}
          readOnly={job.kind === 'close'}
          placeholder="owner/repo"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setRepo(e.target.value)
            if (state.phase === 'error') setState({ phase: 'ready' })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void go()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
        />
        <div className="capture-panel" role="status" aria-live="polite">
          {job.kind === 'create' ? (
            <>
              <span className="ai-summary">
                Nuevo issue{target ? ` en ${target.owner}/${target.repo}` : ''}: «{title}»
              </span>
              {body && <p className="ai-prose gh-body">{body}</p>}
            </>
          ) : (
            <span className="ai-summary">«{title}» está hecha. El issue sigue abierto en GitHub.</span>
          )}
          {state.phase === 'error' && <span className="ai-summary gh-error">{state.message}</span>}
          <span className="capture-foot">
            {state.phase === 'sending' ? (
              <span className="ai-thinking">Enviando</span>
            ) : (
              <button type="button" className="capture-act" onClick={() => void go()}>
                <kbd>↵</kbd> {job.kind === 'create' ? 'crear issue' : 'cerrar issue'}
              </button>
            )}
            <button type="button" className="capture-act" onClick={onCancel}>
              <kbd>esc</kbd> cancelar
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
