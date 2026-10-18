/**
 * The CLI's workspace check asks THIS home's server (server.lock) — never a
 * BAKIN_URL target, which cannot vouch for the local cwd — and withholds the
 * operator declaration when it cannot ask (#898, review r1).
 */
import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'

let localServer: string | null = null
mock.module('../../src/core/server-lock', () => ({
  readLiveServerLock: () => null,
  resolveCliTarget: () => ({ baseUrl: 'http://remote.example:3737', source: 'env' }),
  liveServerBaseUrl: () => localServer,
}))
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => '/tmp/bakin-identity-authority-home' }))

// The no-local-server path checks cwd in-process against this home's runtime.
let localAnswer: () => Promise<string | null> = async () => null
const createAppServices = mock(async () => ({}))
mock.module('../../src/core/app-services', () => ({ createAppServices, maybeGetAppServices: () => undefined }))
mock.module('../../src/core/approvals/agent-context', () => ({ agentContextForPath: () => localAnswer() }))

const originalArgv = process.argv
const originalFetch = globalThis.fetch
const calls: string[] = []
globalThis.fetch = mock(async (input: string | URL | Request) => {
  calls.push(String(input))
  return Response.json({ agentId: null })
}) as unknown as typeof fetch

import { cliIdentity, resetCliIdentityForTests } from '../../src/cli/http'

afterEach(() => {
  resetCliIdentityForTests()
  calls.length = 0
})
afterAll(() => {
  process.argv = originalArgv
  globalThis.fetch = originalFetch
})

describe('cliIdentity workspace authority', () => {
  it('with --as human, asks the local server — not the BAKIN_URL target', async () => {
    process.argv = ['bun', 'bakin', 'doctor', '--fix', '--as', 'human']
    localServer = 'http://127.0.0.1:3737'
    const identity = await cliIdentity()
    expect(identity.operatorDeclared).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toStartWith('http://127.0.0.1:3737/api/approvals/agent-context?cwd=')
  })

  it('with no local server (a remote BAKIN_URL), it checks cwd in-process and asks no server (review r3)', async () => {
    process.argv = ['bun', 'bakin', 'tasks', 'move', 't-1', 'done', '--as', 'human']
    localServer = null
    localAnswer = async () => null
    expect((await cliIdentity()).operatorDeclared).toBe(true)
    expect(createAppServices).toHaveBeenCalled()
    expect(calls).toHaveLength(0)

    resetCliIdentityForTests()
    localAnswer = async () => 'writer'
    expect((await cliIdentity()).agentContext).toBe('writer')
  })

  it('an in-process check that cannot tell withholds the declaration', async () => {
    process.argv = ['bun', 'bakin', 'doctor', '--fix', '--as', 'human']
    localServer = null
    localAnswer = async () => { throw new Error('agent workspaces could not be listed: config unreadable') }
    const errors = mock((..._args: unknown[]) => {})
    const original = console.error
    console.error = errors
    try {
      const identity = await cliIdentity()
      expect(identity.operatorDeclared).toBe(false)
      expect(identity.declarationWithheld).toContain('config unreadable')
    } finally {
      console.error = original
    }
    expect(String(errors.mock.calls[0]?.[0])).toContain('--as human is not honored')
  })

  it('a 503 from the workspace check (it cannot tell) withholds the declaration', async () => {
    process.argv = ['bun', 'bakin', 'doctor', '--fix', '--as', 'human']
    localServer = 'http://127.0.0.1:3737'
    globalThis.fetch = mock(async () => Response.json({ ok: false, error: 'not ready' }, { status: 503 })) as unknown as typeof fetch
    const original = console.error
    console.error = mock(() => {})
    try {
      const identity = await cliIdentity()
      expect(identity.operatorDeclared).toBe(false)
      expect(identity.declarationWithheld).toContain('HTTP 503')
    } finally {
      console.error = original
    }
  })
})
