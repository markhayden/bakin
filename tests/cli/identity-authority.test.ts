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

  it('with no local server it cannot confirm, so the declaration is withheld (and nothing is asked)', async () => {
    process.argv = ['bun', 'bakin', 'doctor', '--fix', '--as', 'human']
    localServer = null
    const errors = mock((..._args: unknown[]) => {})
    const original = console.error
    console.error = errors
    try {
      const identity = await cliIdentity()
      expect(identity.operatorDeclared).toBe(false)
      expect(identity.declarationWithheld).toContain('no Bakin server is running')
    } finally {
      console.error = original
    }
    expect(calls).toHaveLength(0)
    expect(String(errors.mock.calls[0]?.[0])).toContain('--as human is not honored')
  })
})
