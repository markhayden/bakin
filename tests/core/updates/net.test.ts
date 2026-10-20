/** Conditional JSON fetches: validators persisted per endpoint, 304 reuse, rate-limit hints (#1007 D7.3/D7.6). */
import { describe, expect, it, mock } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testDir = join(tmpdir(), `bakin-test-updates-net-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { conditionalFetchJson, HttpStatusError, retryHintMs } from '../../../src/core/updates/net'
import type { ConditionalEntry, ConditionalStore } from '../../../src/core/updates/types'

function memoryStore(): ConditionalStore & { entries: Map<string, ConditionalEntry> } {
  const entries = new Map<string, ConditionalEntry>()
  return { entries, get: (key) => entries.get(key), set: (key, entry) => { entries.set(key, { ...entry, updatedAt: new Date().toISOString() }) } }
}

describe('conditionalFetchJson', () => {
  it('stores the validator and body on 200, sends If-None-Match next time, and reuses the body on 304', async () => {
    const store = memoryStore()
    const requests: Array<Record<string, string> | undefined> = []
    const fetcher = async (_url: string, init?: { headers?: Record<string, string> }) => {
      requests.push(init?.headers)
      if (init?.headers?.['If-None-Match'] === '"v1"') return new Response(null, { status: 304 })
      return new Response(JSON.stringify({ tag: 'v1' }), { status: 200, headers: { ETag: '"v1"', 'Last-Modified': 'Mon, 20 Oct 2026 10:00:00 GMT' } })
    }
    const first = await conditionalFetchJson<{ tag: string }>('https://x/releases/latest', { conditional: store, fetch: fetcher, headers: { Accept: 'application/json' } })
    expect(first).toEqual({ body: { tag: 'v1' }, notModified: false, status: 200 })
    expect(store.entries.get('https://x/releases/latest')).toMatchObject({ etag: '"v1"', lastModified: 'Mon, 20 Oct 2026 10:00:00 GMT', body: { tag: 'v1' } })
    const second = await conditionalFetchJson<{ tag: string }>('https://x/releases/latest', { conditional: store, fetch: fetcher })
    expect(second).toEqual({ body: { tag: 'v1' }, notModified: true, status: 304 })
    expect(requests[1]).toMatchObject({ 'If-None-Match': '"v1"', 'If-Modified-Since': 'Mon, 20 Oct 2026 10:00:00 GMT' })
    expect(requests[0]?.['If-None-Match']).toBeUndefined()
  })

  it('a 304 with nothing stored is an error, never an empty body; the key is the caller\'s normalized endpoint, not the URL', async () => {
    const store = memoryStore()
    await expect(conditionalFetchJson('https://x/a', { conditional: store, fetch: async () => new Response(null, { status: 304 }) })).rejects.toThrow(/no stored representation/)
    await conditionalFetchJson('https://x/a?cache=1', { conditional: store, key: 'repo:owner/name#main', fetch: async () => new Response('{"ok":true}', { headers: { ETag: '"e"' } }) })
    expect([...store.entries.keys()]).toEqual(['repo:owner/name#main'])
  })

  it('403/429 carry the server\'s retry hint; other failures carry the status', async () => {
    const store = memoryStore()
    const reset = Math.floor(Date.now() / 1000) + 90
    const limited = conditionalFetchJson('https://x/a', { conditional: store, fetch: async () => new Response('', { status: 403, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(reset) } }) })
    await expect(limited).rejects.toBeInstanceOf(HttpStatusError)
    await limited.catch((err: HttpStatusError) => { expect(err.status).toBe(403); expect(err.retryAfterMs).toBeGreaterThan(80_000); expect(err.retryAfterMs).toBeLessThanOrEqual(90_000) })
    const retryAfter = conditionalFetchJson('https://x/a', { conditional: store, fetch: async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }) })
    await retryAfter.catch((err: HttpStatusError) => { expect(err.retryAfterMs).toBe(120_000) })
    const server = conditionalFetchJson('https://x/a', { conditional: store, fetch: async () => new Response('', { status: 500 }) })
    await server.catch((err: HttpStatusError) => { expect(err.status).toBe(500); expect(err.retryAfterMs).toBeUndefined() })
  })

  it('retryHintMs reads seconds, HTTP dates, and the reset epoch only when the quota is exhausted', () => {
    const now = Date.parse('2026-10-20T12:00:00Z')
    expect(retryHintMs(new Headers({ 'Retry-After': '30' }), now)).toBe(30_000)
    expect(retryHintMs(new Headers({ 'Retry-After': 'Tue, 20 Oct 2026 12:01:00 GMT' }), now)).toBe(60_000)
    expect(retryHintMs(new Headers({ 'X-RateLimit-Reset': String(now / 1000 + 45), 'X-RateLimit-Remaining': '0' }), now)).toBe(45_000)
    expect(retryHintMs(new Headers({ 'X-RateLimit-Reset': String(now / 1000 + 45), 'X-RateLimit-Remaining': '12' }), now)).toBeUndefined()
    expect(retryHintMs(new Headers(), now)).toBeUndefined()
  })
})
