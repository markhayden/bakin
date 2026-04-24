/**
 * Integration test for the cross-plugin /api/search route.
 *
 * The raw http handler in server.ts delegates to handleCrossPluginSearch
 * (src/core/api-search-handler.ts) — that pure function is what we exercise
 * here. server.ts itself bootstraps Next.js and cannot be imported in tests,
 * so the handler was extracted as part of issue #67 commit C19.
 *
 * Decision D6: /api/search remains as the single cross-plugin search route.
 * All other search endpoints moved to /api/plugins/{id}/search.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-api-search-${process.pid}-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))

mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('@/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
  watchPath: mock(),
}))

const crossTableSearchMock = mock()

mock.module('@/core/search-registry', () => {
  const actual = require('@/core/search-registry') as typeof import('@/core/search-registry')
  return {
    ...actual,
    crossTableSearch: (...args: unknown[]) => crossTableSearchMock(...args),
  }
})

import { handleCrossPluginSearch } from '@/core/api-search-handler'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  crossTableSearchMock.mockReset()
})

const stubResponse = {
  results: [
    { id: 'x', table: 'bakin_tasks', score: 1, fields: { title: 'Foo task' } },
  ],
  meta: { query: 'foo', total: 1, took_ms: 0, source: 'antfly' as const },
}

function makeUrl(qs: string): URL {
  return new URL(`http://localhost:3737/api/search${qs}`)
}

describe('/api/search cross-plugin route', () => {
  it('returns 400 when ?q= is missing', async () => {
    const { status, body } = await handleCrossPluginSearch(makeUrl(''))
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'Missing ?q= parameter' })
    expect(crossTableSearchMock).not.toHaveBeenCalled()
  })

  it('returns 400 when ?q= is empty string', async () => {
    const { status, body } = await handleCrossPluginSearch(makeUrl('?q='))
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'Missing ?q= parameter' })
    expect(crossTableSearchMock).not.toHaveBeenCalled()
  })

  it('runs a cross-plugin multi-query and returns 200 with results + meta', async () => {
    crossTableSearchMock.mockResolvedValueOnce(stubResponse)

    const { status, body } = await handleCrossPluginSearch(makeUrl('?q=foo'))

    expect(status).toBe(200)
    expect(body).toEqual(stubResponse)
    expect(crossTableSearchMock).toHaveBeenCalledTimes(1)
    expect(crossTableSearchMock).toHaveBeenCalledWith('foo', {
      table: undefined,
      limit: undefined,
      offset: undefined,
      facets: undefined,
    })
  })

  it('threads ?table= through to crossTableSearch (single-plugin scoped)', async () => {
    crossTableSearchMock.mockResolvedValueOnce(stubResponse)

    const { status } = await handleCrossPluginSearch(makeUrl('?q=foo&table=tasks'))

    expect(status).toBe(200)
    expect(crossTableSearchMock).toHaveBeenCalledWith('foo', expect.objectContaining({
      table: 'tasks',
    }))
  })

  it('threads ?facets= through as a comma-split array', async () => {
    crossTableSearchMock.mockResolvedValueOnce(stubResponse)

    const { status } = await handleCrossPluginSearch(makeUrl('?q=foo&facets=status,agent'))

    expect(status).toBe(200)
    expect(crossTableSearchMock).toHaveBeenCalledWith('foo', expect.objectContaining({
      facets: ['status', 'agent'],
    }))
  })

  it('drops empty facet entries from a trailing comma', async () => {
    crossTableSearchMock.mockResolvedValueOnce(stubResponse)

    await handleCrossPluginSearch(makeUrl('?q=foo&facets=status,,agent,'))

    expect(crossTableSearchMock).toHaveBeenCalledWith('foo', expect.objectContaining({
      facets: ['status', 'agent'],
    }))
  })

  it('threads ?limit= and ?offset= as numbers', async () => {
    crossTableSearchMock.mockResolvedValueOnce(stubResponse)

    await handleCrossPluginSearch(makeUrl('?q=foo&limit=5&offset=10'))

    expect(crossTableSearchMock).toHaveBeenCalledWith('foo', expect.objectContaining({
      limit: 5,
      offset: 10,
    }))
  })

  it('returns 500 with error payload when the backend throws', async () => {
    crossTableSearchMock.mockRejectedValueOnce(new Error('antfly down'))

    const { status, body } = await handleCrossPluginSearch(makeUrl('?q=foo'))

    expect(status).toBe(500)
    expect(body).toEqual({ error: 'antfly down' })
  })

  it('coerces non-Error rejections to a string in the error payload', async () => {
    crossTableSearchMock.mockRejectedValueOnce('string failure')

    const { status, body } = await handleCrossPluginSearch(makeUrl('?q=foo'))

    expect(status).toBe(500)
    expect(body).toEqual({ error: 'string failure' })
  })
})
