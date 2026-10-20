/** The shared self-update verifier (#1007 D7.11): a NEW boot serving the expected version, nothing less. */
import { describe, expect, it } from 'bun:test'
import { describeSelfUpdateVerification, verifySelfUpdate } from '../../src/lib/self-update-verify'

type Answer = { version: string; bootId: string; state: 'starting' | 'serving' | 'stopping' } | 'down' | { status: number }

/** A scripted /api/version: each poll consumes the next answer; the last repeats. */
function server(answers: Answer[]) {
  const polls: number[] = []
  let index = 0
  const fetch = async (url: string): Promise<Response> => {
    polls.push(index)
    const answer = answers[Math.min(index, answers.length - 1)]!
    index += 1
    if (answer === 'down') throw new Error('ECONNREFUSED')
    if ('status' in answer) return new Response('', { status: answer.status })
    return new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } })
  }
  return { fetch, polls }
}
const instant = { pollMs: 0, sleep: async () => {} }

describe('verifySelfUpdate', () => {
  it('verified: the old boot answers, the gap, a draining successor, then the new boot serving the expected version', async () => {
    const s = server([
      { version: '0.1.0', bootId: 'old', state: 'serving' },
      { version: '0.1.0', bootId: 'old', state: 'stopping' },
      'down',
      'down',
      { version: '0.1.1', bootId: 'new', state: 'starting' },
      { version: '0.1.1', bootId: 'new', state: 'serving' },
    ])
    const result = await verifySelfUpdate({ expectedVersion: 'v0.1.1', oldBootId: 'old', fetch: s.fetch, baseUrl: 'http://127.0.0.1:1', ...instant })
    expect(result).toEqual({ status: 'verified', version: '0.1.1', bootId: 'new' })
    expect(s.polls.length).toBe(6)
  })

  it('an uninterrupted connection: the old boot answers right up to the swap and the new one takes over — verified without any observed disconnect', async () => {
    const s = server([
      { version: '0.1.0', bootId: 'old', state: 'serving' },
      { version: '0.1.0', bootId: 'old', state: 'serving' },
      { version: '0.1.1', bootId: 'new', state: 'serving' },
    ])
    expect((await verifySelfUpdate({ expectedVersion: '0.1.1', oldBootId: 'old', fetch: s.fetch, ...instant })).status).toBe('verified')
  })

  it('wrong version: a new boot that serves something else is definitive', async () => {
    const s = server([{ version: '0.1.0', bootId: 'new', state: 'serving' }])
    const result = await verifySelfUpdate({ expectedVersion: '0.1.1', oldBootId: 'old', fetch: s.fetch, ...instant })
    expect(result).toEqual({ status: 'wrong-version', version: '0.1.0', bootId: 'new', expectedVersion: '0.1.1' })
    expect(describeSelfUpdateVerification(result)).toBe('wrong version 0.1.0 (expected 0.1.1)')
  })

  it('unreachable: no new boot inside the deadline — the old boot, errors and non-2xx answers never count', async () => {
    let t = 0
    const s = server(['down', { status: 503 }, { version: '0.1.0', bootId: 'old', state: 'serving' }])
    const result = await verifySelfUpdate({ expectedVersion: '0.1.1', oldBootId: 'old', fetch: s.fetch, timeoutMs: 1000, pollMs: 0, now: () => (t += 400), sleep: async () => {} })
    expect(result.status).toBe('unreachable')
    expect(describeSelfUpdateVerification(result)).toMatch(/^unreachable — verify by hand/)
  })

  it('a cancelled signal stops polling with an unreachable outcome', async () => {
    const controller = new AbortController()
    controller.abort()
    const s = server([{ version: '0.1.1', bootId: 'new', state: 'serving' }])
    expect((await verifySelfUpdate({ expectedVersion: '0.1.1', oldBootId: 'old', fetch: s.fetch, signal: controller.signal, ...instant })).status).toBe('unreachable')
    expect(s.polls).toEqual([])
  })
})

describe('review round 1 — the deadline bounds every request (#6)', () => {
  it('a connection that never answers (or a body that never ends) is aborted at the deadline — unreachable, not pending forever', async () => {
    let clock = 0
    const aborted: string[] = []
    const fetch = async (_url: string, init?: { signal?: AbortSignal }): Promise<Response> => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted.push(String((init.signal?.reason as Error | undefined)?.message)); reject(init.signal?.reason) }, { once: true })
    })
    const result = await verifySelfUpdate({ expectedVersion: '0.1.1', oldBootId: 'old', fetch, timeoutMs: 100, pollMs: 0, now: () => clock, sleep: async () => { clock += 50 } })
    expect(result.status).toBe('unreachable')
    expect(aborted.length).toBeGreaterThan(0)
    expect(aborted.every((reason) => reason === 'verification deadline')).toBe(true)
  })

  it('the caller\'s cancellation reaches an in-flight request', async () => {
    const controller = new AbortController()
    const fetch = async (_url: string, init?: { signal?: AbortSignal }): Promise<Response> => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
    const verifying = verifySelfUpdate({ expectedVersion: '0.1.1', oldBootId: 'old', fetch, signal: controller.signal, ...instant })
    controller.abort()
    expect(await verifying).toEqual({ status: 'unreachable', expectedVersion: '0.1.1', lastError: 'cancelled' })
  })
})
