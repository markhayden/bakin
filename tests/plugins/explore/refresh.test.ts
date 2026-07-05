/**
 * Remote catalog refresh — injected fetcher, never a real network call.
 * Every failure mode must leave the existing cache untouched.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-explore-refresh-${Date.now()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = `${testDir}-openclaw`

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { refreshRemoteCatalog, REMOTE_CATALOG_URL } from '../../../plugins/explore/lib/refresh'
import { remoteCachePath } from '../../../plugins/explore/lib/catalog'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

const validCatalog = {
  version: 2,
  updatedAt: '2026-08-01T00:00:00Z',
  entries: [
    {
      id: 'new-agent', kind: 'agent', name: 'Newbie', description: 'fresh',
      category: 'Research', source: 'github:markhayden/bakin-bits-official#agents/new-agent',
      trust: 'official',
    },
  ],
}

function seedCache(content: string): void {
  const path = remoteCachePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

describe('refreshRemoteCatalog', () => {
  it('fetches, validates, and caches a valid remote catalog', async () => {
    const fetcher = mock((url: string) => {
      expect(url).toBe(REMOTE_CATALOG_URL)
      return Promise.resolve(new Response(JSON.stringify(validCatalog), { status: 200 }))
    })
    const result = await refreshRemoteCatalog(fetcher)
    expect(result.ok).toBe(true)
    const cached = JSON.parse(readFileSync(remoteCachePath(), 'utf-8'))
    expect(cached.updatedAt).toBe('2026-08-01T00:00:00Z')
  })

  it('reports no-remote-catalog cleanly on 404 without touching the cache', async () => {
    seedCache(JSON.stringify(validCatalog))
    const result = await refreshRemoteCatalog(() => Promise.resolve(new Response('nope', { status: 404 })))
    expect(result).toMatchObject({ ok: false, reason: 'no-remote-catalog' })
    expect(JSON.parse(readFileSync(remoteCachePath(), 'utf-8')).updatedAt).toBe('2026-08-01T00:00:00Z')
  })

  it('network failure leaves the cache untouched', async () => {
    seedCache('{"sentinel": true}')
    const result = await refreshRemoteCatalog(() => Promise.reject(new Error('offline')))
    expect(result).toMatchObject({ ok: false, reason: 'network' })
    expect(readFileSync(remoteCachePath(), 'utf-8')).toBe('{"sentinel": true}')
  })

  it('invalid JSON leaves the cache untouched', async () => {
    seedCache('{"sentinel": true}')
    const result = await refreshRemoteCatalog(() => Promise.resolve(new Response('{ nope', { status: 200 })))
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(readFileSync(remoteCachePath(), 'utf-8')).toBe('{"sentinel": true}')
  })

  it('schema violations are rejected with a specific error', async () => {
    rmSync(remoteCachePath(), { force: true })
    const bad = { version: 2, updatedAt: 'x', entries: [{ id: 'x', kind: 'agent', name: 'X', description: '', category: 'C', trust: 'official' }] }
    // non-builtin agent without source → refine failure
    const result = await refreshRemoteCatalog(() => Promise.resolve(new Response(JSON.stringify(bad), { status: 200 })))
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(existsSync(remoteCachePath())).toBe(false)
  })
})
