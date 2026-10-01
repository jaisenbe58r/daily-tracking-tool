import type { Source, Task } from '../lib/types'
import { childrenOf } from '../lib/tree'

/**
 * «Llevar a GitHub»: the pure part. What an issue made from a task looks like,
 * how a GitHub link is read, and which repository a task goes to. Talking to
 * GitHub lives in `client.ts`.
 */

export interface IssueRef {
  owner: string
  repo: string
  number: number
  kind: 'issue' | 'pull'
}

const URL_RE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)(?:[/?#]\S*)?$/

/** An issue or pull request link, as pasted from the browser. Anything else is null. */
export function parseGithubUrl(text: string): IssueRef | null {
  const m = text.trim().match(URL_RE)
  if (!m) return null
  return { owner: m[1], repo: m[2], number: Number(m[4]), kind: m[3] === 'pull' ? 'pull' : 'issue' }
}

export const refId = (r: Pick<IssueRef, 'owner' | 'repo' | 'number'>) => `${r.owner}/${r.repo}#${r.number}`
export const refUrl = (r: IssueRef) => `https://github.com/${r.owner}/${r.repo}/${r.kind}/${r.number}`

/** What the task's mark shows: `repo#42`, short enough for the row. */
export const shortRef = (source: Pick<Source, 'id' | 'url'>) => {
  const r = refOf(source)
  return r ? `${r.repo}#${r.number}` : 'GitHub'
}

/** The issue behind a GitHub source, from its id (`owner/repo#n`) or its link. */
export function refOf(source: Pick<Source, 'id' | 'url'> | null | undefined): IssueRef | null {
  if (!source) return null
  const fromUrl = parseGithubUrl(source.url)
  const m = source.id?.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/)
  if (m) return { owner: m[1], repo: m[2], number: Number(m[3]), kind: fromUrl?.kind ?? 'issue' }
  return fromUrl
}

export function githubSource(r: IssueRef, url = refUrl(r)): Source {
  return { app: 'github', url, id: refId(r) }
}

/**
 * The issue's body: the task's notes as they are, then its subtasks as
 * GitHub's checklist (nested, done ones ticked). No footer, no labels: one
 * issue, one notification.
 */
export function issueBody(tasks: Task[], id: string): string {
  const task = tasks.find((t) => t.id === id)
  if (!task) return ''
  const lines: string[] = []
  const walk = (parentId: string, depth: number) => {
    for (const t of childrenOf(tasks, parentId)) {
      if (!t.text.trim()) continue
      lines.push(`${'  '.repeat(depth)}- [${t.status === 'done' ? 'x' : ' '}] ${t.text.trim()}`)
      walk(t.id, depth + 1)
    }
  }
  walk(task.id, 0)
  return [task.notes.trim(), lines.join('\n')].filter(Boolean).join('\n\n')
}

export const subtaskCount = (tasks: Task[], id: string) => issueBody(tasks, id).split('\n').filter((l) => /^\s*- \[[ x]\] /.test(l)).length

const REPO_RE = /^([\w.-]+)\/([\w.-]+)$/
export function parseRepo(text: string): { owner: string; repo: string } | null {
  const t = text.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '')
  const m = t.match(REPO_RE)
  return m ? { owner: m[1], repo: m[2] } : null
}

// Which repository each tag goes to, and the last one used: kept in this browser only.
const KEY = 'daily-tracking-tool:github-repos'
interface Repos {
  tags: Record<string, string>
  last: string | null
}
function read(): Repos {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Repos>
    return { tags: raw.tags && typeof raw.tags === 'object' ? raw.tags : {}, last: typeof raw.last === 'string' ? raw.last : null }
  } catch {
    return { tags: {}, last: null }
  }
}

/** The repository a task goes to: the one its first remembered tag points at, else the last used. */
export function repoFor(task: Pick<Task, 'tags'>): string {
  const { tags, last } = read()
  for (const t of task.tags) if (tags[t]) return tags[t]
  return last ?? ''
}

/** After an issue is created: its tags now point at that repository. */
export function rememberRepo(task: Pick<Task, 'tags'>, repo: string) {
  const r = read()
  for (const t of task.tags) r.tags[t] = repo
  r.last = repo
  try {
    localStorage.setItem(KEY, JSON.stringify(r))
  } catch {
    /* private mode: asked again next time */
  }
}

/** Why GitHub said no, in words the user can act on. */
export function githubProblem(error: unknown): string {
  const code = (error as { code?: string })?.code
  if (code === 'needs_reauth') return 'Vuelve a conectar GitHub en claude.ai (Ajustes → Conectores)'
  if (code === 'server_not_connected' || code === 'selection_required') return 'Añade GitHub como conector en claude.ai (Ajustes → Conectores)'
  if (code === 'not_in_manifest' || code === 'not_granted') return 'Esta página no tiene permiso para usar GitHub'
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (/not found|404/i.test(text)) return 'GitHub no encuentra ese repositorio (o no tienes acceso)'
  return 'GitHub no respondió'
}
