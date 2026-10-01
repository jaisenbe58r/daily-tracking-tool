import type { Task } from '../lib/types'
import { snapshot, type Op } from '../ai/ops'
import type { Found } from '../ai/inbox/extract'
import { payloadText } from '../ai/inbox/granola'
import { call, readIssue } from './client'
import { githubSource, parseGithubUrl, refId, refOf, type IssueRef } from './link'

/**
 * GitHub in «Recoger»: only what waits on the user. Three fixed searches,
 * no notifications inbox, no AI: the title of the issue is the task. Tasks
 * linked to an issue that has since closed are proposed as done.
 */

export type GhKind = 'review' | 'changes' | 'assigned'

export interface GhItem {
  kind: GhKind
  ref: IssueRef
  url: string
  title: string
}

const SEARCHES: { kind: GhKind; tool: 'search_pull_requests' | 'search_issues'; query: string }[] = [
  { kind: 'review', tool: 'search_pull_requests', query: 'is:pr is:open review-requested:@me archived:false' },
  { kind: 'changes', tool: 'search_pull_requests', query: 'is:pr is:open author:@me review:changes_requested archived:false' },
  { kind: 'assigned', tool: 'search_issues', query: 'is:issue is:open assignee:@me archived:false' },
]

/** Open tasks linked to an issue, read again per check. */
const MAX_LINKED = 15
const CLOSED = 'cerrado'

/** The search results, whatever shape they come in: `{items}`, a bare list, or that as text. */
export function itemsOf(payload: unknown, kind: GhKind): GhItem[] {
  let data: unknown = payload
  if (data && typeof data === 'object' && 'content' in data) data = payloadText(data)
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return []
    }
  }
  const list = Array.isArray(data) ? data : ((data as { items?: unknown[] } | null)?.items ?? [])
  const out: GhItem[] = []
  for (const raw of list) {
    const it = raw as { html_url?: unknown; title?: unknown; state?: unknown }
    if (typeof it?.html_url !== 'string' || typeof it.title !== 'string') continue
    // Semantic search may bring closed ones too: only what's still open waits on anyone.
    if (it.state && it.state !== 'open') continue
    const ref = parseGithubUrl(it.html_url)
    if (ref) out.push({ kind, ref, url: it.html_url, title: it.title.trim() })
  }
  return out
}

export const ghKey = (item: Pick<GhItem, 'kind' | 'ref'>) => `${refId(item.ref)}@${item.kind}`

const TEXT: Record<GhKind, (title: string) => string> = {
  review: (t) => `Revisar «${t}»`,
  changes: (t) => `Atender cambios en «${t}»`,
  assigned: (t) => t,
}

/**
 * The proposal: one task per item not on the sheet yet (an item found by two
 * searches counts once), and linked tasks whose issue is closed, ticked.
 */
export function githubOps(tasks: Task[], refs: Map<string, string>, items: GhItem[], closed: string[]): { ops: Op[]; keys: string[] } {
  const linked = new Set(tasks.flatMap((t) => (t.source?.app === 'github' ? [refId(refOf(t.source) ?? { owner: '', repo: '', number: 0 })] : [])))
  const refFor = new Map([...refs].map(([ref, id]) => [id, ref]))
  const ops: Op[] = []
  const keys: string[] = []
  const taken = new Set<string>()
  for (const item of items) {
    keys.push(ghKey(item))
    const id = refId(item.ref)
    if (linked.has(id) || taken.has(id)) continue
    taken.add(id)
    ops.push({ op: 'add', text: TEXT[item.kind](item.title), parent: null, tags: [], due: null, source: githubSource(item.ref, item.url) })
  }
  for (const taskId of closed) {
    const ref = refFor.get(taskId)
    const r = refOf(tasks.find((t) => t.id === taskId)?.source)
    if (!ref || !r) continue
    keys.push(`${refId(r)}@${CLOSED}`)
    ops.push({ op: 'update', id: ref, status: 'done' })
  }
  return { ops, keys }
}

export function summaryOf(ops: Op[]): string {
  const added = ops.filter((o) => o.op === 'add').length
  const done = ops.length - added
  return [added ? `${added} ${added === 1 ? 'tarea' : 'tareas'} de GitHub` : '', done ? `${done} ${done === 1 ? 'cerrada' : 'cerradas'} en GitHub` : '']
    .filter(Boolean)
    .join(' · ')
}

/**
 * What GitHub has for the user right now, as a proposal (null: nothing new).
 * Without the connector it stays quiet: not everyone uses GitHub.
 */
export async function githubFound(tasks: Task[], today: string, seen: (c: { id: string; version: string }) => boolean): Promise<{ found: Found | null; problem?: string }> {
  let problem: string | undefined
  const quiet = (error: unknown) => {
    const code = (error as { code?: string })?.code
    if (code !== 'server_not_connected' && code !== 'selection_required' && code !== 'not_in_manifest') problem ??= 'GitHub no respondió'
  }
  const found = await Promise.all(SEARCHES.map((s) => call(s.tool, { query: s.query, perPage: 30 }).then((p) => itemsOf(p, s.kind), (e) => (quiet(e), [] as GhItem[]))))
  const items = found.flat().filter((i) => !seen({ id: refId(i.ref), version: i.kind }))

  const open = tasks.filter((t) => t.status !== 'done' && t.source?.app === 'github').slice(0, MAX_LINKED)
  const closed: string[] = []
  await Promise.all(
    open.map(async (t) => {
      const r = refOf(t.source)
      if (!r) return
      const info = await readIssue(r).catch(() => null)
      // Proposed once: a task kept open on purpose isn't asked about again.
      if (info?.state === 'closed' && !seen({ id: refId(r), version: CLOSED })) closed.push(t.id)
    }),
  )

  const { refs } = snapshot(tasks, today)
  const { ops, keys } = githubOps(tasks, refs, items, closed)
  if (!ops.length) return { found: keys.length ? { summary: '', ops, refs, keys, count: 0, replies: 0, dropped: 0 } : null, problem }
  return { found: { summary: summaryOf(ops), ops, refs, keys, count: ops.length, replies: 0, dropped: 0, github: ops.length }, problem }
}
