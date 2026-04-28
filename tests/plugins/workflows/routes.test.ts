/**
 * Workflows plugin — search route integration test.
 *
 * Activates the workflows plugin against a mocked PluginContext and exercises
 * the auto-registered GET /search route via `seedResults` + `callSearchRoute`
 * helpers from `tests/plugins/test-helpers.ts`.
 *
 * The workflows plugin registers a file-backed content type (`bakin_workflows`)
 * during `activate()`, which causes the test helper to auto-register the
 * `/search` route.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  activatePlugin,
  callSearchRoute,
  type ActivatedPlugin,
} from '../test-helpers'

// ─── Test directory ────────────────────────────────────────────────────────

const testDir = join(tmpdir(), `bakin-test-workflows-search-${Date.now()}`)

// ─── Mocks (must be declared before any plugin imports) ────────────────────

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../../src/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
}))

mock.module('../../../src/core/audit', () => ({
  appendAudit: mock(),
}))

mock.module('../../../plugins/tasks/lib/flow-store', () => ({
  createTask: mock(() => Promise.resolve({ id: 'mock-task' })),
  addTaskLog: mock(() => Promise.resolve()),
  moveTask: mock(() => Promise.resolve()),
  readTaskboard: mock(() => ({
    columns: { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] },
  })),
  getTask: mock(() => null),
  getTaskWithColumn: mock(() => null),
}))

;(globalThis as unknown as { __bakinBroadcast?: unknown }).__bakinBroadcast = mock()

// ─── Plugin import (after mocks) ───────────────────────────────────────────

import workflowsPlugin from '../../../plugins/workflows'

// ─── Setup ─────────────────────────────────────────────────────────────────

let activated: ActivatedPlugin

beforeAll(async () => {
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true })
  }
  activated = await activatePlugin(workflowsPlugin, testDir)
})

afterAll(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true })
  }
})

beforeEach(() => {
  activated.seedResults([])
})

// ─── Search Route ──────────────────────────────────────────────────────────

describe('Workflows Plugin — GET /search', () => {
  it('auto-registers a /search route via registerFileBackedContentType', () => {
    const route = activated.routes.find(
      (r) => r.method === 'GET' && r.path === '/search',
    )
    expect(route).toBeDefined()
  })

  it('returns seeded workflow definition results for a valid query', async () => {
    activated.seedResults([
      {
        id: 'def:content-pipeline',
        table: 'bakin_workflows',
        score: 0.95,
        fields: {
          name: 'Content Pipeline',
          description: 'Generate and publish content',
          type: 'definition',
          status: 'active',
        },
      },
      {
        id: 'def:onboarding',
        table: 'bakin_workflows',
        score: 0.72,
        fields: {
          name: 'Onboarding',
          description: 'Welcome new agents',
          type: 'definition',
          status: 'active',
        },
      },
    ])

    const { status, body } = await callSearchRoute(activated, 'pipeline')

    expect(status).toBe(200)
    const results = body.results as Array<{ id: string; score: number; table: string }>
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('def:content-pipeline')
    expect(results[0].score).toBe(0.95)
    expect(results[0].table).toBe('bakin_workflows')
  })

  it('returns 400 when q is missing', async () => {
    const { status, body } = await callSearchRoute(activated, '')

    expect(status).toBe(400)
    expect(body.error).toBe('Missing ?q= parameter')
  })

  it('returns 200 with empty results when no matches', async () => {
    const { status, body } = await callSearchRoute(activated, 'no-matches')

    expect(status).toBe(200)
    expect(body.results).toEqual([])
  })

  it('passes parsed type,status facets to ctx.search.query', async () => {
    await callSearchRoute(activated, 'pipeline', { facets: 'type,status' })

    expect(activated.ctx.search.query).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'pipeline',
        facets: ['type', 'status'],
      }),
    )
  })
})
