import { claudeHost } from '../ai/config'
import { payloadText } from '../ai/inbox/granola'
import { parseGithubUrl, type IssueRef } from './link'

/**
 * Talks to GitHub through the user's own claude.ai connector named «GitHub»
 * (GitHub's MCP server, added as a custom connector). The page never sees a
 * token and only declares the tools below. Outside claude.ai `github()` is null.
 */
export const GITHUB = 'GitHub'

interface Mcp {
  callTool(server: string, tool: string, input?: unknown, options?: { cache?: false }): Promise<{ payload?: unknown }>
}

let mcp: Promise<Mcp | null> | null = null
export function github(): Promise<Mcp | null> {
  mcp ??= claudeHost()?.use('mcp').then((m) => (m as Mcp) ?? null, () => null) ?? Promise.resolve(null)
  return mcp
}

async function call(tool: string, input: unknown): Promise<unknown> {
  const m = await github()
  if (!m) throw Object.assign(new Error('no github'), { code: 'server_not_connected' })
  return (await m.callTool(GITHUB, tool, input, { cache: false })).payload
}

/** The JSON the server answered, whether it came parsed or as text. */
function json(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && !('content' in payload)) return payload as Record<string, unknown>
  try {
    const parsed = JSON.parse(payloadText(payload))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Finds the issue's link in whatever shape the answer has. */
export function issueLink(payload: unknown): { ref: IssueRef; url: string } | null {
  const o = json(payload)
  for (const key of ['html_url', 'url']) {
    const v = o[key]
    if (typeof v === 'string') {
      const ref = parseGithubUrl(v)
      if (ref) return { ref, url: v }
    }
  }
  const m = (typeof payload === 'string' ? payload : payloadText(payload) || JSON.stringify(payload ?? '')).match(
    /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+/,
  )
  const ref = m ? parseGithubUrl(m[0]) : null
  return ref && m ? { ref, url: m[0] } : null
}

export async function createIssue(owner: string, repo: string, title: string, body: string) {
  const link = issueLink(await call('issue_write', { method: 'create', owner, repo, title, ...(body ? { body } : {}) }))
  if (!link) throw new Error('GitHub creó algo que no sé leer')
  return link
}

export async function closeIssue(r: IssueRef) {
  await call('issue_write', { method: 'update', owner: r.owner, repo: r.repo, issue_number: r.number, state: 'closed', state_reason: 'completed' })
}

export interface IssueInfo {
  title: string
  state: 'open' | 'closed'
  /** Pull requests only: merged into their base. */
  merged: boolean
}

/** Title and state of an issue or pull request (both are issues to GitHub). */
export async function readIssue(r: IssueRef): Promise<IssueInfo> {
  const o = json(await call('issue_read', { method: 'get', owner: r.owner, repo: r.repo, issue_number: r.number }))
  return {
    title: typeof o.title === 'string' ? o.title : '',
    state: o.state === 'closed' ? 'closed' : 'open',
    merged: Boolean((o.pull_request as { merged_at?: unknown } | undefined)?.merged_at),
  }
}
