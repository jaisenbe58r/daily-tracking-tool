import { beforeEach, describe, expect, it, vi } from 'vitest'

// Gmail answers in pages; Calendar with a week of events; Granola isn't connected.
const calls: { server: string; tool: string; input: { query?: string; pageToken?: string } }[] = []
const thread = (id: string) => ({ id, messages: [{ id: `${id}m`, sender: 'x@y.es', toRecipients: ['otro@y.es'] }] })
vi.mock('../config', () => ({
  claudeHost: () => ({
    use: async () => ({
      callTool: async (server: string, tool: string, input: { query?: string; pageToken?: string }) => {
        calls.push({ server, tool, input })
        if (server === 'Granola') throw Object.assign(new Error('x'), { code: 'server_not_connected' })
        if (server === 'Google Calendar') return { payload: { summary: 'yo@captia.com', events: [{ id: 'e1' }, { id: 'e2' }] } }
        if (tool !== 'search_threads') return { payload: {} }
        if (!input.query?.startsWith('in:inbox')) return { payload: { threads: [] } }
        const page = Number(input.pageToken ?? 0)
        return { payload: { threads: Array.from({ length: 50 }, (_, i) => thread(`p${page}-${i}`)), ...(page < 3 ? { nextPageToken: String(page + 1) } : {}) } }
      },
    }),
  }),
}))

describe('what a check reads', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('follows Gmail pages past the first 50 threads and says what each source gave', async () => {
    const { gather, scanLine } = await import('./connectors')
    const got = await gather(() => false)
    expect(calls.filter((c) => c.input.query?.startsWith('in:inbox')).map((c) => c.input.pageToken ?? '0')).toEqual(['0', '1', '2', '3'])
    expect(got!.scanned.gmail).toEqual({ threads: 200, read: 0 })
    expect(scanLine(got!.scanned)).toBe('Gmail 200 hilos (7 días) · Agenda 2 eventos (próx. 7 días) · Granola sin conectar')
  })
})
