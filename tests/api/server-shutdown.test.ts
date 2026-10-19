/**
 * #898 K — identity + shutdown REQUEST routes. The CLI never signals a pid:
 * it asks, and the server checks the lock secret AND its own boot id.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-server-shutdown-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) }))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => join(testDir, 'openclaw'), getOpenClawPath: (...p: string[]) => join(testDir, 'openclaw', ...p), resetOpenClawHome: () => {} }))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) }))

const SECRET = 's3cret'
const triggered: string[] = []
let state: 'starting' | 'serving' | 'stopping' = 'serving'
mock.module('../../src/core/server-lock', () => ({
  CLI_SECRET_HEADER: 'X-Bakin-Cli-Secret',
  cliSecretMatches: (presented: string | null) => presented === SECRET,
}))
mock.module('../../src/core/lifecycle', () => ({
  getServerState: () => state,
  triggerShutdown: (reason: string) => { triggered.push(reason) },
}))

import { post } from '../../packages/host/src/api/server/shutdown'
import { get } from '../../packages/host/src/api/version'
import { getBootId } from '../../src/core/boot-id'
import { settleFor, waitUntil } from '../helpers/wait'

const url = new URL('http://127.0.0.1/api/server/shutdown')
const request = (headers: Record<string, string>, body: unknown) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

beforeEach(() => { triggered.length = 0; state = 'serving' })
afterAll(() => { /* nothing written */ })

describe('GET /api/version — the generation\'s own identity', () => {
  it('answers the PROCESS pid, its boot id and its state — never values read back from the lock', async () => {
    const body = await (await get(new Request('http://127.0.0.1/api/version'), new URL('http://127.0.0.1/api/version'))).json() as Record<string, unknown>
    expect(body).toMatchObject({ pid: process.pid, bootId: getBootId(), state: 'serving' })
    expect(typeof body.version).toBe('string')
  })
})

describe('POST /api/server/shutdown', () => {
  it('refuses a request without THIS boot\'s lock secret (another home, a stranger)', async () => {
    const res = await post(request({ 'X-Bakin-Cli-Secret': 'nope' }, { bootId: getBootId() }), url)
    expect(res.status).toBe(403)
    await settleFor(120, 'an accepted request would trigger shutdown 50 ms after answering')
    expect(triggered).toEqual([])
  })

  it('refuses a request naming another boot (a predecessor, a successor)', async () => {
    const res = await post(request({ 'X-Bakin-Cli-Secret': SECRET }, { bootId: 'some-other-boot' }), url)
    expect(res.status).toBe(409)
    await settleFor(120, 'an accepted request would trigger shutdown 50 ms after answering')
    expect(triggered).toEqual([])
  })

  it('accepts only the exact secret + boot, answers 202, then shuts down gracefully', async () => {
    const res = await post(request({ 'X-Bakin-Cli-Secret': SECRET }, { bootId: getBootId() }), url)
    expect(res.status).toBe(202)
    expect(await res.json()).toMatchObject({ ok: true, pid: process.pid, bootId: getBootId() })
    await waitUntil(() => triggered.length > 0, { label: 'graceful shutdown triggered' })
    expect(triggered).toEqual(['cli-shutdown'])
  })

  it('a malformed body is refused', async () => {
    const res = await post(new Request(url, { method: 'POST', headers: { 'X-Bakin-Cli-Secret': SECRET }, body: 'not json' }), url)
    expect(res.status).toBe(400)
  })
})
