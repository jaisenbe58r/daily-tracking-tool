import { describe, expect, it } from 'vitest'
import { newTask } from '../lib/tree'
import type { Task } from '../lib/types'
import { issueBody, parseGithubUrl, parseRepo, refOf, shortRef, subtaskCount } from './link'
import { issueLink } from './client'

const task = (id: string, text: string, parentId: string | null = null, extra: Partial<Task> = {}): Task => ({ ...newTask(parentId, text), id, ...extra })

describe('GitHub links', () => {
  it('reads issue and pull request links, nothing else', () => {
    expect(parseGithubUrl('https://github.com/captia/zimvie/issues/42')).toEqual({ owner: 'captia', repo: 'zimvie', number: 42, kind: 'issue' })
    expect(parseGithubUrl(' https://github.com/captia/zimvie/pull/7/files#diff ')).toMatchObject({ number: 7, kind: 'pull' })
    expect(parseGithubUrl('https://github.com/captia/zimvie')).toBeNull()
    expect(parseGithubUrl('mira https://github.com/captia/zimvie/issues/42')).toBeNull()
  })

  it('names the issue by repo and number', () => {
    const source = { url: 'https://github.com/captia/zimvie/issues/42', id: 'captia/zimvie#42' }
    expect(shortRef(source)).toBe('zimvie#42')
    expect(refOf({ url: 'https://github.com/a/b/pull/3' })).toEqual({ owner: 'a', repo: 'b', number: 3, kind: 'pull' })
  })

  it('takes owner/repo typed or pasted as a link', () => {
    expect(parseRepo('captia/zimvie')).toEqual({ owner: 'captia', repo: 'zimvie' })
    expect(parseRepo('https://github.com/captia/zimvie/')).toEqual({ owner: 'captia', repo: 'zimvie' })
    expect(parseRepo('zimvie')).toBeNull()
  })
})

describe('issueBody', () => {
  const tasks = [
    task('p', 'Proyecto ZimVie', null, { notes: 'Cliente: ZimVie' }),
    task('a', 'Revisar alarmas', 'p', { status: 'done' }),
    task('b', 'Validar torno 04', 'p'),
    task('c', 'Consultar IT', 'b'),
    task('e', '  ', 'p'),
    task('d', 'Preparar informe', 'p'),
    task('x', 'Otra cosa'),
  ]
  it('is the notes, then the subtasks as a nested checklist', () => {
    expect(issueBody(tasks, 'p')).toBe('Cliente: ZimVie\n\n- [x] Revisar alarmas\n- [ ] Validar torno 04\n  - [ ] Consultar IT\n- [ ] Preparar informe')
    expect(subtaskCount(tasks, 'p')).toBe(4)
  })
  it('is empty for a bare task', () => {
    expect(issueBody(tasks, 'x')).toBe('')
  })
})

describe('issueLink', () => {
  it('finds the link in a parsed answer, a text answer or MCP content', () => {
    const url = 'https://github.com/captia/zimvie/issues/43'
    expect(issueLink({ id: '1', url })?.ref.number).toBe(43)
    expect(issueLink(JSON.stringify({ html_url: url }))?.url).toBe(url)
    expect(issueLink({ content: [{ type: 'text', text: `{"id":"9","url":"${url}"}` }] })?.ref.repo).toBe('zimvie')
    expect(issueLink({ url: 'https://api.github.com/repos/captia/zimvie/issues/43', html_url: url })?.url).toBe(url)
    expect(issueLink({ ok: true })).toBeNull()
  })
})
