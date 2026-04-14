/**
 * Tests for the SearchAPI auto-registration helper in search-registry.ts.
 *
 * Covers `buildSearchAPI(pluginId, opts)` — specifically the
 * `maybeAutoRegisterSearchRoute` side effect that wires a `GET /search`
 * route the moment a plugin registers a content type, plus the
 * `skipFileBackedWiring` escape hatch used by the Next.js catch-all.
 *
 * Mandatory test isolation per CLAUDE.md: every filesystem-touching
 * dependency is mocked to a temp dir / vi.fn so this test never reads
 * or writes ~/.bakin/.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync } from 'fs'
import type { APIRoute } from '../../packages/core/src/plugin-types'

const testDir = join(tmpdir(), `bakin-test-search-autoreg-${Date.now()}`)

vi.mock('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    root: testDir,
    settings: join(testDir, 'settings.json'),
    pluginSettings: join(testDir, 'plugin-settings'),
    plugins: join(testDir, 'plugins'),
    audit: join(testDir, 'audit.jsonl'),
    logs: join(testDir, 'logs'),
  }),
}))

vi.mock('@/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock watcher so registerFileBackedContentType doesn't try to attach
// real chokidar hooks — we assert call counts to verify the
// skipFileBackedWiring branch.
vi.mock('@/core/watcher', () => ({
  registerSyncHook: vi.fn(),
  registerUnlinkHook: vi.fn(),
}))

// Mock antfly so api.query() returns a deterministic stub instead of
// hitting the real backend.
vi.mock('@/core/antfly', () => ({
  enabled: vi.fn(() => true),
  available: vi.fn(() => true),
  createTable: vi.fn(async () => true),
  listTables: vi.fn(async () => []),
  indexDocument: vi.fn(async () => {}),
  removeDocument: vi.fn(async () => {}),
  transformDocument: vi.fn(async () => {}),
  rebuildIndexes: vi.fn(async () => {}),
  batchIndex: vi.fn(async (_t: string, docs: Record<string, unknown>) => Object.keys(docs).length),
  multiQuery: vi.fn(async () => ({ results: [], total: 0, took: 0 })),
  queryTable: vi.fn(async () => ({
    results: [{ id: 'doc-1', table: 'bakin_widgets', score: 0.9, fields: { title: 'Hi' } }],
    aggregations: undefined,
    took: 7,
    total: 1,
  })),
  getIndexHealth: vi.fn(async () => null),
  getTableStats: vi.fn(async () => null),
}))

vi.mock('@/core/settings', () => ({
  getSettings: vi.fn(() => ({
    antfly: {
      enabled: true,
      url: 'http://localhost:8080/api/v1',
      search: {
        strategy: 'rrf',
        defaultLimit: 20,
        reranker: { enabled: false, provider: 'termite', model: 'm', threshold: 0 },
      },
      embedders: {
        default: { provider: 'termite', model: 'BAAI/bge-small-en-v1.5' },
      },
      chunking: { defaultTargetTokens: 200, defaultOverlapTokens: 25 },
      auditTtl: '90d',
      cleanupInterval: '24h',
    },
  })),
}))

vi.mock('@/core/sse', () => ({
  broadcast: vi.fn(),
}))

import { buildSearchAPI, resetSearchRegistry } from '@/core/search-registry'
import * as antfly from '@/core/antfly'
import * as watcher from '@/core/watcher'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('search-registry buildSearchAPI auto-registration', () => {
  beforeEach(() => {
    resetSearchRegistry()
    vi.clearAllMocks()
    vi.mocked(antfly.enabled).mockReturnValue(true)
  })

  function makeDef(table = 'widgets') {
    return {
      table,
      schema: {
        title: { type: 'text' as const },
        status: { type: 'keyword' as const },
      },
      searchableFields: ['title'],
      embeddingTemplate: '{{title}}',
      facets: ['status'],
      reindex: async function* () {
        yield { key: 'k1', doc: { title: 'one' } }
      },
      verifyExists: async () => true,
    }
  }

  function makeFileBackedDef(table = 'widgets') {
    return {
      ...makeDef(table),
      filePatterns: [
        {
          pattern: 'widgets/**/*.md',
          fileToId: (rel: string) => rel,
          fileToDoc: async () => ({ title: 'x' }),
        },
      ],
    }
  }

  // ── happy path: route is registered exactly once ────────────────────

  it('registerContentType pushes exactly one GET /search route onto registerRoute', () => {
    const routes: APIRoute[] = []
    const api = buildSearchAPI('widgets', {
      registerRoute: (r) => routes.push(r),
    })
    api.registerContentType(makeDef('widgets'))

    expect(routes).toHaveLength(1)
    expect(routes[0]!.path).toBe('/search')
    expect(routes[0]!.method).toBe('GET')
    expect(routes[0]!.description).toContain('widgets')
    expect(typeof routes[0]!.handler).toBe('function')
  })

  // ── idempotency: many registrations, one route ──────────────────────

  it('registerContentType called twice still only registers one /search route', () => {
    const routes: APIRoute[] = []
    const api = buildSearchAPI('widgets', { registerRoute: (r) => routes.push(r) })
    api.registerContentType(makeDef('widgets'))
    api.registerContentType(makeDef('widgets'))

    expect(routes).toHaveLength(1)
  })

  it('registerFileBackedContentType after registerContentType does not double-register the /search route', () => {
    const routes: APIRoute[] = []
    const api = buildSearchAPI('widgets', { registerRoute: (r) => routes.push(r) })
    api.registerContentType(makeDef('widgets'))
    api.registerFileBackedContentType(makeFileBackedDef('widgets'))

    expect(routes).toHaveLength(1)
  })

  // ── opt-out: no registerRoute means no auto-route ───────────────────

  it('registerContentType built without registerRoute opt does not call any route registrar', () => {
    // Build with no opts at all — nothing to spy on, but the call must
    // succeed and we know from the implementation that the only path to
    // route registration is opts.registerRoute.
    const api = buildSearchAPI('widgets')
    expect(() => api.registerContentType(makeDef('widgets'))).not.toThrow()
  })

  it('registerContentType with opts.registerRoute === undefined behaves like the bare form', () => {
    const api = buildSearchAPI('widgets', {})
    expect(() => api.registerContentType(makeDef('widgets'))).not.toThrow()
  })

  // ── handler behavior: 400 / query passthrough / params parsing ──────

  it('auto-registered /search handler returns 400 when ?q= is missing', async () => {
    let captured: APIRoute | null = null
    const api = buildSearchAPI('widgets', { registerRoute: (r) => { captured = r } })
    api.registerContentType(makeDef('widgets'))

    expect(captured).not.toBeNull()
    const route = captured! as APIRoute
    const res = await route.handler(new Request('http://localhost/search'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/q/)
  })

  it('auto-registered /search handler calls api.query when q is present', async () => {
    let captured: APIRoute | null = null
    const api = buildSearchAPI('widgets', { registerRoute: (r) => { captured = r } })
    api.registerContentType(makeDef('widgets'))

    const res = await (captured! as APIRoute).handler(
      new Request('http://localhost/search?q=hello'),
    )
    expect(res.status).toBe(200)
    expect(antfly.queryTable).toHaveBeenCalledWith(
      'bakin_widgets',
      'hello',
      expect.objectContaining({ indexes: ['embeddings'] }),
    )
  })

  it('auto-registered /search handler threads limit, offset, and comma-split facets through to api.query', async () => {
    let captured: APIRoute | null = null
    const api = buildSearchAPI('widgets', { registerRoute: (r) => { captured = r } })
    api.registerContentType(makeDef('widgets'))

    await (captured! as APIRoute).handler(
      new Request('http://localhost/search?q=foo&limit=7&offset=14&facets=status,owner,tags'),
    )

    expect(antfly.queryTable).toHaveBeenCalledWith(
      'bakin_widgets',
      'foo',
      expect.objectContaining({
        limit: 7,
        offset: 14,
        aggregations: expect.objectContaining({
          status: { type: 'terms', field: 'status', size: 50 },
          owner: { type: 'terms', field: 'owner', size: 50 },
          tags: { type: 'terms', field: 'tags', size: 50 },
        }),
      }),
    )
  })

  it('auto-registered /search handler tolerates an empty facets param', async () => {
    let captured: APIRoute | null = null
    const api = buildSearchAPI('widgets', { registerRoute: (r) => { captured = r } })
    api.registerContentType(makeDef('widgets'))

    const res = await (captured! as APIRoute).handler(
      new Request('http://localhost/search?q=foo&facets='),
    )
    // Comma-split with `.filter(Boolean)` on empty string yields []. The
    // handler should not 500; query should still fire.
    expect(res.status).toBe(200)
    expect(antfly.queryTable).toHaveBeenCalled()
  })

  // ── skipFileBackedWiring escape hatch ───────────────────────────────

  it('registerFileBackedContentType still auto-registers /search when skipFileBackedWiring is true', () => {
    const routes: APIRoute[] = []
    const api = buildSearchAPI('widgets', {
      registerRoute: (r) => routes.push(r),
      skipFileBackedWiring: true,
    })
    api.registerFileBackedContentType(makeFileBackedDef('widgets'))

    expect(routes).toHaveLength(1)
    expect(routes[0]!.path).toBe('/search')
  })

  it('registerFileBackedContentType with skipFileBackedWiring=true does NOT call watcher hooks', () => {
    const api = buildSearchAPI('widgets', {
      registerRoute: () => {},
      skipFileBackedWiring: true,
    })
    api.registerFileBackedContentType(makeFileBackedDef('widgets'))

    expect(watcher.registerSyncHook).not.toHaveBeenCalled()
    expect(watcher.registerUnlinkHook).not.toHaveBeenCalled()
  })

  it('registerFileBackedContentType without skipFileBackedWiring DOES wire watcher hooks', () => {
    const api = buildSearchAPI('widgets', { registerRoute: () => {} })
    api.registerFileBackedContentType(makeFileBackedDef('widgets'))

    expect(watcher.registerSyncHook).toHaveBeenCalledTimes(1)
    expect(watcher.registerUnlinkHook).toHaveBeenCalledTimes(1)
  })
})
