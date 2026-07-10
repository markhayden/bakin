/**
 * Tests for the SearchAPI auto-registration helper in search-registry.ts.
 *
 * Covers `buildSearchAPI(pluginId, opts)` — specifically the
 * `maybeAutoRegisterSearchRoute` side effect that wires a `GET /search`
 * route the moment a plugin registers a content type, plus the
 * `skipFileBackedWiring` escape hatch used by the Next.js catch-all.
 *
 * Mandatory test isolation per CLAUDE.md: every filesystem-touching
 * dependency is mocked to a temp dir / mock so this test never reads
 * or writes ~/.bakin/.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync } from 'fs'
import type { RegisteredAPIRoute } from '../../packages/core/src/plugin-types'
import { clearSearchAdapter, createSearchAdapterHarness, installSearchAdapter } from '../helpers/search-adapter'

const testDir = join(tmpdir(), `bakin-test-search-autoreg-${Date.now()}`)

const contentDirFactory = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    root: testDir,
    settings: join(testDir, 'settings.json'),
    pluginSettings: join(testDir, 'plugin-settings'),
    plugins: join(testDir, 'plugins'),
    audit: join(testDir, 'audit.jsonl'),
    logs: join(testDir, 'logs'),
  }),
})
mock.module('@/core/content-dir', contentDirFactory)
// The search outbox reads packages/core/src/content-dir directly — mock BOTH
// resolvers (CLAUDE.md § Testing Rules), else the real one hits ~/.bakin.
mock.module('../../packages/core/src/content-dir', contentDirFactory)

mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

// Mock watcher so registerFileBackedContentType doesn't try to attach
// real chokidar hooks — we assert call counts to verify the
// skipFileBackedWiring branch.
mock.module('@/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
}))

mock.module('@/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: mock(() => ({
    search: {
      adapter: 'antfly',
      settings: {
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
    },
  })),
}))

mock.module('@/core/sse', () => ({
  broadcast: mock(),
}))

import { buildSearchAPI, getContentTypes, resetSearchRegistry, unregisterContentTypesByPlugin } from '@/core/search-registry'
import * as watcher from '@/core/watcher'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('search-registry buildSearchAPI auto-registration', () => {
  let searchHarness: ReturnType<typeof createSearchAdapterHarness>

  beforeEach(() => {
    resetSearchRegistry()
    searchHarness = createSearchAdapterHarness()
    installSearchAdapter(searchHarness.adapter)
    mock.clearAllMocks()
  })

  afterEach(() => {
    clearSearchAdapter()
  })

  function makeDef(table = 'widgets') {
    return {
      table,
      schemaVersion: 1,
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
    const routes: RegisteredAPIRoute[] = []
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
    const routes: RegisteredAPIRoute[] = []
    const api = buildSearchAPI('widgets', { registerRoute: (r) => routes.push(r) })
    api.registerContentType(makeDef('widgets'))
    api.registerContentType(makeDef('widgets'))

    expect(routes).toHaveLength(1)
  })

  it('registerFileBackedContentType after registerContentType does not double-register the /search route', () => {
    const routes: RegisteredAPIRoute[] = []
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
    let captured: RegisteredAPIRoute | null = null
    const api = buildSearchAPI('widgets', { registerRoute: (r) => { captured = r } })
    api.registerContentType(makeDef('widgets'))

    expect(captured).not.toBeNull()
    const route = captured! as RegisteredAPIRoute
    const res = await route.handler(new Request('http://localhost/search'), {} as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/q/)
  })

  it('auto-registered /search handler calls api.query when q is present', async () => {
    let captured: RegisteredAPIRoute | null = null
    const api = buildSearchAPI('widgets', { registerRoute: (r) => { captured = r } })
    api.registerContentType(makeDef('widgets'))

    const res = await (captured! as RegisteredAPIRoute).handler(
      new Request('http://localhost/search?q=hello'),
      {} as never,
    )
    expect(res.status).toBe(200)
    expect(searchHarness.calls.query).toHaveBeenCalledWith(
      'bakin_widgets',
      expect.objectContaining({ text: 'hello' }),
    )
    expect(searchHarness.calls.query.mock.calls[0][1].adapterOptions).toEqual(
      expect.objectContaining({ indexes: ['embeddings'] }),
    )
  })

  it('auto-registered /search handler threads limit, offset, and comma-split facets through to api.query', async () => {
    let captured: RegisteredAPIRoute | null = null
    const api = buildSearchAPI('widgets', { registerRoute: (r) => { captured = r } })
    api.registerContentType(makeDef('widgets'))

    await (captured! as RegisteredAPIRoute).handler(
      new Request('http://localhost/search?q=foo&limit=7&offset=14&facets=status,owner,tags'),
      {} as never,
    )

    expect(searchHarness.calls.query).toHaveBeenCalledWith(
      'bakin_widgets',
      expect.objectContaining({
        text: 'foo',
        limit: 7,
        offset: 14,
        facets: ['status', 'owner', 'tags'],
      }),
    )
  })

  it('auto-registered /search handler tolerates an empty facets param', async () => {
    let captured: RegisteredAPIRoute | null = null
    const api = buildSearchAPI('widgets', { registerRoute: (r) => { captured = r } })
    api.registerContentType(makeDef('widgets'))

    const res = await (captured! as RegisteredAPIRoute).handler(
      new Request('http://localhost/search?q=foo&facets='),
      {} as never,
    )
    // Comma-split with `.filter(Boolean)` on empty string yields []. The
    // handler should not 500; query should still fire.
    expect(res.status).toBe(200)
    expect(searchHarness.calls.query).toHaveBeenCalledWith(
      'bakin_widgets',
      expect.objectContaining({
        text: 'foo',
        facets: [],
      }),
    )
  })

  // ── skipFileBackedWiring escape hatch ───────────────────────────────

  it('registerFileBackedContentType still auto-registers /search when skipFileBackedWiring is true', () => {
    const routes: RegisteredAPIRoute[] = []
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

  it('rewiring the same file-backed content type disposes stale watcher hooks', () => {
    const disposeSync = mock()
    const disposeUnlink = mock()
    vi.mocked(watcher.registerSyncHook).mockReturnValueOnce(disposeSync)
    vi.mocked(watcher.registerUnlinkHook).mockReturnValueOnce(disposeUnlink)

    const api = buildSearchAPI('widgets', { registerRoute: () => {} })
    api.registerFileBackedContentType(makeFileBackedDef('widgets'))
    api.registerFileBackedContentType(makeFileBackedDef('widgets'))

    expect(watcher.registerSyncHook).toHaveBeenCalledTimes(2)
    expect(watcher.registerUnlinkHook).toHaveBeenCalledTimes(2)
    expect(disposeSync).toHaveBeenCalledTimes(1)
    expect(disposeUnlink).toHaveBeenCalledTimes(1)
  })

  it('unregisterContentTypesByPlugin removes registrations and disposes watcher hooks without dropping tables', () => {
    const disposeSync = mock()
    const disposeUnlink = mock()
    vi.mocked(watcher.registerSyncHook).mockReturnValueOnce(disposeSync)
    vi.mocked(watcher.registerUnlinkHook).mockReturnValueOnce(disposeUnlink)

    const api = buildSearchAPI('widgets', { registerRoute: () => {} })
    api.registerFileBackedContentType(makeFileBackedDef('widgets'))

    expect(getContentTypes().has('bakin_widgets')).toBe(true)
    expect(unregisterContentTypesByPlugin('widgets')).toBe(1)
    expect(getContentTypes().has('bakin_widgets')).toBe(false)
    expect(disposeSync).toHaveBeenCalledTimes(1)
    expect(disposeUnlink).toHaveBeenCalledTimes(1)
    expect(searchHarness.calls.tablesDrop).not.toHaveBeenCalled()
  })
})
