import { describe, expect, it } from 'vitest'
import { newTask } from '../lib/tree'
import type { Task } from '../lib/types'
import { snapshot } from '../ai/ops'
import { githubOps, itemsOf, summaryOf } from './inbox'
import { merge } from '../ai/inbox/useInbox'

const task = (id: string, text: string, extra: Partial<Task> = {}): Task => ({ ...newTask(null, text), id, ...extra })
const pr = (n: number, title: string, state = 'open') => ({ number: n, title, state, html_url: `https://github.com/captia/zimvie/pull/${n}` })

describe('itemsOf', () => {
  it('reads {items}, a bare list and MCP text, and keeps only open ones', () => {
    const body = { total_count: 2, items: [pr(51, 'Fix alarmas'), pr(52, 'Viejo', 'closed')] }
    expect(itemsOf(body, 'review').map((i) => i.ref.number)).toEqual([51])
    expect(itemsOf([pr(7, 'A')], 'changes')[0]).toMatchObject({ kind: 'changes', title: 'A', url: 'https://github.com/captia/zimvie/pull/7' })
    expect(itemsOf({ content: [{ type: 'text', text: JSON.stringify(body) }] }, 'review')).toHaveLength(1)
    expect(itemsOf('not json', 'assigned')).toEqual([])
  })
})

describe('githubOps', () => {
  const tasks = [
    task('a', 'Proyecto ZimVie', { source: { app: 'github', url: 'https://github.com/captia/zimvie/issues/42', id: 'captia/zimvie#42' } }),
    task('b', 'Ya vinculada', { source: { app: 'github', url: 'https://github.com/captia/zimvie/pull/51', id: 'captia/zimvie#51' } }),
  ]
  const { refs } = snapshot(tasks, '2026-10-01')
  it('proposes new items once, skips linked ones and ticks closed issues', () => {
    const items = [
      ...itemsOf([pr(51, 'Fix alarmas'), pr(60, 'Login SSO')], 'review'),
      ...itemsOf([pr(60, 'Login SSO')], 'changes'),
      ...itemsOf([{ number: 38, title: 'Validar lectura torno 04', state: 'open', html_url: 'https://github.com/captia/zimvie/issues/38' }], 'assigned'),
    ]
    const { ops, keys } = githubOps(tasks, refs, items, ['a'])
    expect(ops.map((o) => o.text ?? `${o.id}:${o.status}`)).toEqual(['Revisar «Login SSO»', 'Validar lectura torno 04', 't1:done'])
    expect(ops[0].source).toEqual({ app: 'github', url: 'https://github.com/captia/zimvie/pull/60', id: 'captia/zimvie#60' })
    expect(keys).toContain('captia/zimvie#60@changes')
    expect(keys).toContain('captia/zimvie#42@cerrado')
    expect(summaryOf(ops)).toBe('2 tareas de GitHub · 1 cerrada en GitHub')
  })
})

describe('merge', () => {
  const base = { refs: new Map(), replies: 0, dropped: 0 }
  it('joins mail and GitHub into one proposal', () => {
    const mail = { ...base, summary: '3 tareas de tu correo', ops: [{ op: 'add' as const, text: 'x' }], keys: ['m@1'], count: 1, replies: 1 }
    const gh = { ...base, summary: '1 tarea de GitHub', ops: [{ op: 'add' as const, text: 'y' }], keys: ['g@review'], count: 1, github: 1 }
    expect(merge(mail, gh)).toMatchObject({ summary: '3 tareas de tu correo · 1 tarea de GitHub', count: 2, replies: 1, github: 1, keys: ['m@1', 'g@review'] })
    expect(merge(null, gh)).toBe(gh)
  })
})
