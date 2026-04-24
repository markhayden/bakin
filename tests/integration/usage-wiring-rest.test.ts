/**
 * Integration test: REST request path wires into the unified usage recorder.
 *
 * Exercises `trackResponse` end-to-end (no recorder mocking) against a fake
 * req/res pair and asserts the entry shows up in `getUsageFeed`. Proves the
 * "real" wiring works — not just that trackResponse calls a spy.
 */

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-usage-wiring-rest-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    root: testDir,
    settings: join(testDir, 'settings.json'),
    audit: join(testDir, 'audit.jsonl'),
    logs: join(testDir, 'logs'),
  }),
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

// Defensive: even though this test never imports the tasks plugin, the repo's
// test-isolation hook scans test files for plugin references and requires a
// mock any time "plugins/tasks" appears in the source. Several `/api/tasks`
// fixture URLs trip that check, so we stub flow-store to keep the hook green
// and guarantee the tasks storage layer can never be reached from this file.
mock.module('../../plugins/tasks/lib/flow-store', () => ({}))

import { trackResponse, normalizePath } from '../../src/core/rest-tracking'
import { getUsageFeed, clearUsage } from '../../src/core/usage'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

interface FakeReqResOpts {
  method?: string
  headers?: Record<string, string>
  statusCode?: number
}

function makeFakeReqRes(opts: FakeReqResOpts = {}) {
  const req = {
    method: opts.method ?? 'GET',
    headers: opts.headers ?? {},
  } as any
  const res = {
    end: mock(),
    statusCode: opts.statusCode ?? 200,
  } as any
  return { req, res }
}

function urlFor(pathAndQuery: string): URL {
  return new URL(pathAndQuery, 'http://localhost:3737')
}

describe('usage-wiring-rest', () => {
  beforeEach(() => {
    clearUsage()
  })

  it('records a REST usage entry on the happy path', () => {
    const { req, res } = makeFakeReqRes()
    const url = urlFor('/api/version')
    const start = Date.now()

    trackResponse(req, res, url, start)
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.totals.count).toBe(1)
    expect(feed.recent).toHaveLength(1)
    const entry = feed.recent[0]
    expect(entry.kind).toBe('rest')
    expect(entry.name).toBe('/api/version')
    expect(entry.status).toBe('ok')
    expect(entry.durationMs).not.toBeNull()
    expect(entry.durationMs! >= 0).toBe(true)
    expect(entry.meta).toMatchObject({ method: 'GET', httpStatus: 200 })
  })

  it('attributes the agent from the x-bakin-agent header', () => {
    const { req, res } = makeFakeReqRes({ headers: { 'x-bakin-agent': 'main-operator' } })
    trackResponse(req, res, urlFor('/api/tasks'), Date.now())
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.recent[0].agent).toBe('main-operator')
  })

  it('attributes the agent from the ?agent= query param', () => {
    const { req, res } = makeFakeReqRes()
    trackResponse(req, res, urlFor('/api/tasks?agent=pixel'), Date.now())
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.recent[0].agent).toBe('pixel')
  })

  it('prefers the header over the query param when both are set', () => {
    const { req, res } = makeFakeReqRes({ headers: { 'x-bakin-agent': 'main-operator' } })
    trackResponse(req, res, urlFor('/api/tasks?agent=pixel'), Date.now())
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.recent[0].agent).toBe('main-operator')
  })

  it('records a null agent when neither header nor query is set', () => {
    const { req, res } = makeFakeReqRes()
    trackResponse(req, res, urlFor('/api/tasks'), Date.now())
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.recent[0].agent).toBeNull()
  })

  it('marks responses with status >= 400 as errors', () => {
    const { req, res } = makeFakeReqRes({ statusCode: 500 })
    trackResponse(req, res, urlFor('/api/tasks'), Date.now())
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.recent[0].status).toBe('error')
    expect(feed.totals.errors).toBe(1)
    expect(feed.recent[0].meta).toMatchObject({ httpStatus: 500 })
  })

  it('keeps /api/plugins/* paths verbatim (non-UUID plugin ids preserved)', () => {
    const { req, res } = makeFakeReqRes()
    trackResponse(req, res, urlFor('/api/plugins/tasks/abc-123'), Date.now())
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.recent[0].name).toBe('/api/plugins/tasks/abc-123')
  })

  it('normalizes UUID segments outside /api/plugins/* to :id', () => {
    const { req, res } = makeFakeReqRes()
    trackResponse(
      req,
      res,
      urlFor('/api/something/550e8400-e29b-41d4-a716-446655440000/edit'),
      Date.now(),
    )
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.recent[0].name).toBe('/api/something/:id/edit')
  })

  it('normalizePath helper matches the wiring behavior', () => {
    // Sanity check the helper directly so regressions surface with a clearer
    // failure than the integration cases above.
    expect(normalizePath('/api/plugins/tasks/abc-123')).toBe('/api/plugins/tasks/abc-123')
    expect(
      normalizePath('/api/something/550e8400-e29b-41d4-a716-446655440000/edit'),
    ).toBe('/api/something/:id/edit')
    expect(normalizePath('/api/version')).toBe('/api/version')
  })
})
