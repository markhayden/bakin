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
mock.module('../../packages/core/src/content-dir', () => ({
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
// fixture URLs trip that check, so we stub task-store to keep the hook green
// and guarantee the tasks storage layer can never be reached from this file.
mock.module('@/core/task-store', () => ({}))

import { trackResponse, normalizePath } from '../../src/core/rest-tracking'
import {
  clearUsage,
  getInteractionSummary,
  getUsageFeed,
  getUsageStats,
} from '../../src/core/usage'

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

    trackResponse(req, res, url, start, 'user')
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.totals.count).toBe(1)
    expect(feed.recent).toHaveLength(1)
    const entry = feed.recent[0]
    expect(entry.kind).toBe('rest')
    expect(entry.activityClass).toBe('user')
    expect(entry.name).toBe('/api/version')
    expect(entry.status).toBe('ok')
    expect(entry.durationMs).not.toBeNull()
    expect(entry.durationMs! >= 0).toBe(true)
    expect(entry.meta).toMatchObject({ method: 'GET', httpStatus: 200 })
  })

  it('attributes the agent from the x-bakin-agent header', () => {
    const { req, res } = makeFakeReqRes({ headers: { 'x-bakin-agent': 'main-operator' } })
    trackResponse(req, res, urlFor('/api/tasks'), Date.now(), 'user')
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.recent[0].agent).toBe('main-operator')
  })

  it('attributes the agent from the ?agent= query param', () => {
    const { req, res } = makeFakeReqRes()
    trackResponse(req, res, urlFor('/api/tasks?agent=pixel'), Date.now(), 'user')
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.recent[0].agent).toBe('pixel')
  })

  it('prefers the header over the query param when both are set', () => {
    const { req, res } = makeFakeReqRes({ headers: { 'x-bakin-agent': 'main-operator' } })
    trackResponse(req, res, urlFor('/api/tasks?agent=pixel'), Date.now(), 'user')
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.recent[0].agent).toBe('main-operator')
  })

  it('records a null agent when neither header nor query is set', () => {
    const { req, res } = makeFakeReqRes()
    trackResponse(req, res, urlFor('/api/tasks'), Date.now(), 'user')
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.recent[0].agent).toBeNull()
  })

  it('marks 5xx responses as errors', () => {
    const { req, res } = makeFakeReqRes({ statusCode: 500 })
    trackResponse(req, res, urlFor('/api/tasks'), Date.now(), 'user')
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.recent[0].status).toBe('error')
    expect(feed.totals.errors).toBe(1)
    expect(feed.recent[0].meta).toMatchObject({ httpStatus: 500 })
  })

  it('shows 4xx as failed activity without feeding the raw 5xx watchdog rate', () => {
    const { req, res } = makeFakeReqRes({ statusCode: 404 })
    trackResponse(req, res, urlFor('/api/agents/avatar'), Date.now(), 'user')
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.recent[0].status).toBe('error')
    expect(feed.totals.errors).toBe(1)
    expect(feed.recent[0].meta).toMatchObject({ httpStatus: 404 })
    expect(getUsageStats({ kind: 'rest', window: '5m' })).toEqual({ total: 1, errors: 0 })
  })

  it('keeps /api/plugins/* paths verbatim (non-UUID plugin ids preserved)', () => {
    const { req, res } = makeFakeReqRes()
    trackResponse(req, res, urlFor('/api/plugins/tasks/abc-123'), Date.now(), 'user')
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.recent[0].name).toBe('/api/plugins/tasks/abc-123')
  })

  it('keeps raw plugin request names while grouping matched parameter routes by template', () => {
    for (const taskId of ['task-a', 'task-b']) {
      const { req, res } = makeFakeReqRes({
        statusCode: taskId === 'task-b' ? 500 : 200,
      })
      trackResponse(
        req,
        res,
        urlFor(`/api/plugins/tasks/${taskId}`),
        Date.now(),
        'user',
        '/api/plugins/tasks/:taskId',
      )
      res.end()
    }

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.topByName).toContainEqual({
      kind: 'rest',
      method: 'GET',
      name: '/api/plugins/tasks/:taskId',
      count: 2,
      errors: 1,
      medianDurationMs: expect.any(Number),
    })
    expect(feed.failureGroups).toContainEqual({
      kind: 'rest',
      name: '/api/plugins/tasks/:taskId',
      destination: '/api/plugins/tasks/:taskId',
      method: 'GET',
      attempts: 2,
      failures: 1,
      firstFailureAt: expect.any(String),
      lastFailureAt: expect.any(String),
      agents: [],
      unattributedFailures: 1,
      systemFailures: 0,
      medianFailureDurationMs: expect.any(Number),
      latestFailure: expect.objectContaining({
        name: '/api/plugins/tasks/task-b',
        meta: expect.objectContaining({
          routePattern: '/api/plugins/tasks/:taskId',
          method: 'GET',
        }),
      }),
    })
    expect(feed.recent.map((entry) => entry.name).sort()).toEqual([
      '/api/plugins/tasks/task-a',
      '/api/plugins/tasks/task-b',
    ])
    expect(feed.recent.every((entry) => (
      entry.meta?.routePattern === '/api/plugins/tasks/:taskId'
      && entry.meta?.method === 'GET'
    ))).toBe(true)

    expect(getInteractionSummary({ window: '5m' }).topDestinations).toContainEqual({
      category: 'api',
      name: '/api/plugins/tasks/:taskId',
      count: 2,
      errors: 1,
      medianDurationMs: expect.any(Number),
    })
  })

  it('keeps unknown plugin destinations grouped by their raw path', () => {
    const { req, res } = makeFakeReqRes()
    trackResponse(req, res, urlFor('/api/plugins/tasks/not-declared'), Date.now(), 'user')
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.topByName[0]?.name).toBe('/api/plugins/tasks/not-declared')
    expect(feed.recent[0].meta?.routePattern).toBeUndefined()
  })

  it('normalizes UUID segments outside /api/plugins/* to :id', () => {
    const { req, res } = makeFakeReqRes()
    trackResponse(
      req,
      res,
      urlFor('/api/something/550e8400-e29b-41d4-a716-446655440000/edit'),
      Date.now(),
      'user',
    )
    res.end()

    const feed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(feed.recent[0].name).toBe('/api/something/:id/edit')
  })

  it('keeps failed routine requests while hiding successful routine requests by default', () => {
    const success = makeFakeReqRes()
    trackResponse(success.req, success.res, urlFor('/api/status'), Date.now(), 'routine')
    success.res.end()

    const failure = makeFakeReqRes({ statusCode: 503 })
    trackResponse(failure.req, failure.res, urlFor('/api/status'), Date.now(), 'routine')
    failure.res.end()

    const defaultFeed = getUsageFeed({ kind: 'rest', window: '5m' })
    expect(defaultFeed.recent).toHaveLength(1)
    expect(defaultFeed.recent[0]).toMatchObject({
      activityClass: 'routine',
      status: 'error',
    })

    const completeFeed = getUsageFeed({ kind: 'rest', window: '5m', includeRoutine: true })
    expect(completeFeed.recent).toHaveLength(2)
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
