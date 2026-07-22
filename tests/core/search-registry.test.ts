import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { clearSearchAdapter, createSearchAdapterHarness, installSearchAdapter } from '../helpers/search-adapter'

const testDir = join(tmpdir(), `bakin-search-registry-test-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

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

mock.module('@/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: mock(() => ({
    plugins: {
      requireSignatures: false,
      trustedSigners: [],
    },
    search: {
      adapter: 'antfly',
      settings: {
        enabled: true,
        url: 'http://localhost:8080/api/v1',
        search: {
          strategy: 'rrf',
          defaultLimit: 20,
          reranker: { enabled: true, provider: 'antfly', model: 'mixedbread-ai/mxbai-rerank-base-v1', threshold: 0.0 },
        },
        embedders: {
          default: { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5' },
          visual: { provider: 'antfly', model: 'openai/clip-vit-base-patch32' },
        },
        chunking: { defaultTargetTokens: 200, defaultOverlapTokens: 25 },
        auditTtl: '90d',
        cleanupInterval: '24h',
      },
    },
  })),
}))

mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('@/core/sse', () => ({
  broadcast: mock(),
}))

import {
  buildSearchAPI,
  getContentTypes,
  getTableForPlugin,
  createRegisteredTables,
  resetSearchRegistry,
  crossTableSearch,
  getSearchHealth,
  purgeContentType,
  rebuildRegisteredTables,
  pumpParkedMigrations,
} from '@/core/search-registry'
import { sweepOrphanRegistryRows } from '@/core/search-orphan-sweep'
import { tableStatus } from '@bakin/core/search/tables'
import { enqueueIndex, outboxStats } from '@bakin/core/search/outbox'
import { broadcast } from '@/core/sse'

describe('search-registry', () => {
  let searchHarness: ReturnType<typeof createSearchAdapterHarness>

  beforeEach(() => {
    resetSearchRegistry()
    searchHarness = createSearchAdapterHarness()
    searchHarness.calls.query.mockImplementation(async () => ({
      hits: [
        { key: 'doc-1', document: { title: 'Test task' }, score: 0.95 },
      ],
      total: 1,
      facets: { status: [{ value: 'active', count: 5 }] },
      diagnostics: { strategy: 'hybrid', durationMs: 12 },
    }))
    installSearchAdapter(searchHarness.adapter)
    mock.clearAllMocks()
  })

  afterEach(() => {
    clearSearchAdapter()
  })

  function makeDef(table = 'tasks') {
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
      reindex: async function* () { yield { key: 'k1', doc: { title: 'test' } } },
      verifyExists: async () => true,
    }
  }

  it('registerContentType adds to registry with bakin_ prefix', () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    expect(getContentTypes().size).toBe(1)
    expect(getContentTypes().has('bakin_tasks')).toBe(true)
    expect(getTableForPlugin('tasks')).toBe('bakin_tasks')
  })

  it('getTableForPlugin returns null for unknown plugin', () => {
    expect(getTableForPlugin('nonexistent')).toBeNull()
  })

  it('rejects a second DIRECT (primary) content type for one plugin', () => {
    const api = buildSearchAPI('multi')
    api.registerContentType(makeDef('one'))
    // A plugin gets exactly one primary content type; the second direct
    // registration fails early rather than silently overwriting the resolver.
    expect(() => api.registerContentType(makeDef('two'))).toThrow(/already has a primary/)
    // The first one is still the resolvable table.
    expect(getTableForPlugin('multi')).toBe('bakin_one')
  })

  it('getTableForPlugin returns null when the registry is completely empty', () => {
    // Reset wipes all registrations — no content types at all.
    resetSearchRegistry()
    expect(getContentTypes().size).toBe(0)
    expect(getTableForPlugin('anything')).toBeNull()
  })

  it('the primary-conflict error names the existing primary and the rejected table', () => {
    const api = buildSearchAPI('multi')
    api.registerContentType(makeDef('alpha'))
    expect(() => api.registerContentType(makeDef('beta'))).toThrow(/bakin_alpha/)
    expect(() => api.registerContentType(makeDef('beta'))).toThrow(/bakin_beta/)
  })

  it('registerContentType preserves pluginId', () => {
    const api = buildSearchAPI('my-plugin')
    api.registerContentType(makeDef('widgets'))

    const entry = getContentTypes().get('bakin_widgets')
    expect(entry?.pluginId).toBe('my-plugin')
  })

  it('allows the same plugin to re-register its own table', () => {
    const api = buildSearchAPI('owner')
    api.registerContentType(makeDef('widgets'))
    api.registerContentType(makeDef('widgets'))

    const entry = getContentTypes().get('bakin_widgets')
    expect(entry?.pluginId).toBe('owner')
  })

  it('rejects another plugin taking over an already-owned table', () => {
    buildSearchAPI('owner').registerContentType(makeDef('widgets'))

    expect(() => buildSearchAPI('intruder').registerContentType(makeDef('widgets')))
      .toThrow('already registered by plugin "owner"')

    const entry = getContentTypes().get('bakin_widgets')
    expect(entry?.pluginId).toBe('owner')
  })

  // ── auto-registration of /search route (C1 — issue #67) ──────────────

  it('registerContentType auto-registers a GET /search route when registerRoute opt is provided', () => {
    const routes: Array<{ path: string; method: string }> = []
    const api = buildSearchAPI('tasks', {
      registerRoute: (r) => routes.push({ path: r.path, method: r.method }),
    })
    api.registerContentType(makeDef('tasks'))

    expect(routes).toHaveLength(1)
    expect(routes[0]).toEqual({ path: '/search', method: 'GET' })
  })

  it('registerContentType auto-route is idempotent across multiple calls', () => {
    const routes: Array<{ path: string; method: string }> = []
    const api = buildSearchAPI('tasks', { registerRoute: (r) => routes.push(r) })
    api.registerContentType(makeDef('tasks'))
    api.registerContentType(makeDef('tasks'))

    expect(routes).toHaveLength(1)
  })

  it('registerContentType does not register a route when registerRoute opt is absent', () => {
    const api = buildSearchAPI('tasks')
    // Smoke test — the bare form still works for tests and reconciles.
    expect(() => api.registerContentType(makeDef('tasks'))).not.toThrow()
  })

  it('auto-registered /search route handler pipes through api.query', async () => {
    let captured: { path: string; method: string; handler: (req: Request) => Promise<Response> } | null = null
    const api = buildSearchAPI('tasks', {
      registerRoute: (r) => { captured = r as typeof captured },
    })
    api.registerContentType(makeDef('tasks'))
    expect(captured).not.toBeNull()

    const route = captured as unknown as { handler: (req: Request) => Promise<Response> }

    // Missing `q` → 400
    const missing = await route.handler(new Request('http://localhost/search'))
    expect(missing.status).toBe(400)

    // With `q` → 200 + adapter query hit
    const ok = await route.handler(new Request('http://localhost/search?q=build&facets=status&limit=5'))
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body.meta.source).toBe('search')
    expect(searchHarness.calls.query).toHaveBeenCalledWith(
      'bakin_tasks',
      expect.objectContaining({ text: 'build', limit: 5 }),
    )
  })

  it('index calls search.documents.index with resolved table', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await api.index('task-1', { title: 'Build feature' })

    expect(searchHarness.calls.documentsIndex).toHaveBeenCalledWith(
      'bakin_tasks',
      'task-1',
      { title: 'Build feature' },
    )
  })

  it('remove calls search.documents.remove', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await api.remove('task-1')

    expect(searchHarness.calls.documentsRemove).toHaveBeenCalledWith('bakin_tasks', 'task-1')
  })

  it('maintenance.scan is scoped to the plugin table', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))
    await api.index('task-1', { title: 'Build feature' })

    const rows = []
    for await (const row of api.maintenance!.scan({ fields: ['title'] })) rows.push(row)

    expect(searchHarness.calls.scan).toHaveBeenCalledWith('bakin_tasks', { fields: ['title'] })
    expect(rows).toEqual([{ key: 'task-1', document: { title: 'Build feature' } }])
  })

  it('maintenance.batchRemove is scoped to the plugin table', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))
    await api.index('task-1', { title: 'Build feature' })

    const removed = await api.maintenance!.batchRemove(['task-1'])

    expect(removed).toBe(1)
    expect(searchHarness.calls.documentsBatchRemove).toHaveBeenCalledWith('bakin_tasks', ['task-1'])
  })

  it('transform calls search.documents.transform with $set ops', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await api.transform('task-1', [
      { op: '$set', field: 'status', value: 'done' },
    ])

    expect(searchHarness.calls.documentsTransform).toHaveBeenCalledWith(
      'bakin_tasks',
      'task-1',
      expect.any(Function),
    )
  })

  it('query calls search.query and maps response', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const result = await api.query({ q: 'build feature', facets: ['status'] })

    expect(searchHarness.calls.query).toHaveBeenCalledWith(
      'bakin_tasks',
      expect.objectContaining({
        text: 'build feature',
        facets: ['status'],
        adapterOptions: expect.objectContaining({ indexes: ['embeddings'] }),
      }),
    )
    expect(searchHarness.calls.query.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        facets: ['status'],
      }),
    )
    expect(result.meta.source).toBe('search')
    expect(result.results).toHaveLength(1)
    expect(result.aggregations?.status).toEqual([{ value: 'active', count: 5 }])
  })

  // ── multi-index support (T3) ─────────────────────────────────────────

  it('buildTableConfig synthesizes a single default index when def.indexes is absent', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await createRegisteredTables()

    expect(searchHarness.calls.tablesCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^bakin_tasks_v\d+_[0-9a-f]{8}$/),
      expect.objectContaining({
        legs: [
          expect.objectContaining({ name: 'full_text', capability: 'full-text', fields: ['title'] }),
          expect.objectContaining({
            name: 'embeddings',
            capability: 'text-embedding',
            fields: ['title'],
            template: '{{title}}',
          }),
        ],
        adapterOptions: expect.objectContaining({ defaultType: 'tasks' }),
      }),
    )
  })

  it('buildTableConfig creates one adapter index per entry when def.indexes is set', async () => {
    const api = buildSearchAPI('assets')
    api.registerContentType({
      ...makeDef('assets'),
      indexes: [
        {
          name: 'assets_text',
          embedderRef: 'default',
          embeddingTemplate: '{{description}} {{tags}}',
          chunker: { enabled: true, targetTokens: 200, overlapTokens: 25 },
        },
        {
          name: 'assets_visual',
          embedderRef: 'visual',
          mediaUrlField: 'image_url',
        },
      ],
    })

    await createRegisteredTables()

    expect(searchHarness.calls.tablesCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^bakin_assets_v\d+_[0-9a-f]{8}$/),
      expect.objectContaining({
        legs: [
          expect.objectContaining({ name: 'full_text', capability: 'full-text' }),
          expect.objectContaining({
            name: 'assets_text',
            capability: 'text-embedding',
            template: '{{description}} {{tags}}',
            chunker: { enabled: true, targetTokens: 200, overlapTokens: 25 },
          }),
          expect.objectContaining({
            name: 'assets_visual',
            capability: 'media-embedding',
            mediaUrlField: 'image_url',
          }),
        ],
      }),
    )
  })

  it('query routes multiple index names through to search.query', async () => {
    const api = buildSearchAPI('assets')
    api.registerContentType({
      ...makeDef('assets'),
      indexes: [
        { name: 'assets_text', embedderRef: 'default', embeddingTemplate: '{{description}}' },
        { name: 'assets_visual', embedderRef: 'visual', mediaUrlField: 'image_url' },
      ],
    })

    await api.query({ q: 'kafka diagram' })

    expect(searchHarness.calls.query).toHaveBeenCalledWith(
      'bakin_assets',
      expect.objectContaining({
        text: 'kafka diagram',
        adapterOptions: expect.objectContaining({ indexes: ['assets_text', 'assets_visual'] }),
      }),
    )
  })

  // ── aggregations passthrough (T5) ───────────────────────────────────

  it('query passes raw aggregations through to search.query', async () => {
    searchHarness.calls.query.mockResolvedValueOnce({
      hits: [],
      aggregations: {
        byDate: { buckets: [{ key: '2026-04-01', doc_count: 3 }] },
      },
      total: 0,
      diagnostics: { strategy: 'hybrid', durationMs: 5 },
    })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const result = await api.query({
      q: 'any',
      aggregations: {
        byDate: { type: 'date_histogram', field: 'created_at', interval: 'day' },
      },
    })

    expect(searchHarness.calls.query).toHaveBeenCalledWith(
      'bakin_tasks',
      expect.objectContaining({
        text: 'any',
        aggregations: [
          { name: 'byDate', type: 'histogram', field: 'created_at', interval: 'day' },
        ],
      }),
    )
    expect(result.rawAggregations).toEqual({
      byDate: { buckets: [{ key: '2026-04-01', doc_count: 3 }] },
    })
  })

  it('query merges caller aggregations with facet-derived aggregations', async () => {
    searchHarness.calls.query.mockResolvedValueOnce({
      hits: [],
      aggregations: {},
      total: 0,
      diagnostics: { strategy: 'hybrid', durationMs: 1 },
    })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await api.query({
      q: 'any',
      facets: ['status'],
      aggregations: {
        byDate: { type: 'date_histogram', field: 'created_at', interval: 'day' },
      },
    })

    expect(searchHarness.calls.query).toHaveBeenCalledWith(
      'bakin_tasks',
      expect.objectContaining({
        text: 'any',
        facets: ['status'],
        aggregations: [
          { name: 'byDate', type: 'histogram', field: 'created_at', interval: 'day' },
        ],
      }),
    )
  })

  it('caller aggregations preserve their own names alongside facets', async () => {
    searchHarness.calls.query.mockResolvedValueOnce({
      hits: [],
      aggregations: {},
      total: 0,
      diagnostics: { strategy: 'hybrid', durationMs: 1 },
    })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await api.query({
      q: 'any',
      facets: ['status'],
      aggregations: {
        status: { type: 'terms', field: 'status', size: 500 },
      },
    })

    expect(searchHarness.calls.query).toHaveBeenCalledWith(
      'bakin_tasks',
      expect.objectContaining({
        text: 'any',
        facets: ['status'],
        aggregations: [
          { name: 'status', type: 'count', field: 'status' },
        ],
      }),
    )
  })

  it('createRegisteredTables surfaces adapter table creation failures', async () => {
    const api = buildSearchAPI('broken')
    api.registerContentType({
      ...makeDef('broken'),
      indexes: [
        { name: 'bad', embedderRef: 'does-not-exist', embeddingTemplate: '{{x}}' },
      ],
    })

    searchHarness.calls.tablesCreate.mockRejectedValueOnce(new Error('bad config'))
    const result = await createRegisteredTables()

    expect(searchHarness.calls.tablesCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^bakin_broken_v\d+_[0-9a-f]{8}$/),
      expect.anything(),
    )
    expect(result.failures).toEqual([
      { table: 'bakin_broken', pluginId: 'broken', error: 'bad config' },
    ])
  })

  it('query reports unavailable when no content type registered', async () => {
    const api = buildSearchAPI('orphan-plugin')
    const result = await api.query({ q: 'test' })

    expect(result.meta.source).toBe('unavailable')
    expect(result.results).toEqual([])
  })

  it('createRegisteredTables calls search.tables.create for each type', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const api2 = buildSearchAPI('assets')
    api2.registerContentType(makeDef('assets'))

    await createRegisteredTables()

    expect(searchHarness.calls.tablesCreate).toHaveBeenCalledTimes(2)
    expect(searchHarness.calls.tablesCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^bakin_tasks_v\d+_[0-9a-f]{8}$/),
      expect.objectContaining({ adapterOptions: expect.objectContaining({ description: expect.stringContaining('tasks') }) }),
    )
    expect(searchHarness.calls.tablesCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^bakin_assets_v\d+_[0-9a-f]{8}$/),
      expect.objectContaining({ adapterOptions: expect.objectContaining({ description: expect.stringContaining('assets') }) }),
    )
  })

  it('createRegisteredTables is idempotent', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await createRegisteredTables()
    await createRegisteredTables()

    expect(searchHarness.calls.tablesCreate).toHaveBeenCalledTimes(1)
  })

  it('index warns and no-ops when no content type registered', async () => {
    const api = buildSearchAPI('unregistered')
    await api.index('key', { data: 'test' })
    expect(searchHarness.calls.documentsIndex).not.toHaveBeenCalled()
  })

  // ── crossTableSearch ────────────────────────────────────────────────

  it('crossTableSearch passes the query budget as per-table deadlineMs (default 2000)', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await crossTableSearch('build', { table: 'tasks' })
    expect(searchHarness.calls.query).toHaveBeenCalledWith(
      'bakin_tasks',
      expect.objectContaining({ deadlineMs: 2000 }),
    )

    await crossTableSearch('build')
    const entries = searchHarness.calls.multiQuery.mock.calls.at(-1)![0] as Array<{ query: { deadlineMs?: number } }>
    expect(entries[0]!.query.deadlineMs).toBe(2000)
  })

  it('crossTableSearch reports per-table outcomes and a partial flag when a source misses budget', async () => {
    buildSearchAPI('tasks').registerContentType(makeDef('tasks'))
    buildSearchAPI('assets').registerContentType(makeDef('assets'))

    searchHarness.calls.multiQuery.mockResolvedValue([
      { hits: [{ key: 'd1', document: {}, score: 0.9 }], total: 1, diagnostics: { strategy: 'hybrid', durationMs: 5 } },
      { hits: [], total: 0, diagnostics: { strategy: 'none', budget: 'omitted', durationMs: 2001 } },
    ])

    const result = await crossTableSearch('hello')

    expect(result.meta.partial).toBe(true)
    expect(result.meta.tables).toEqual([
      { table: 'bakin_tasks', hits: 1, took_ms: 5 },
      { table: 'bakin_assets', hits: 0, took_ms: 2001, budget: 'omitted' },
    ])
  })

  it('crossTableSearch omits the partial flag when every source answered in budget', async () => {
    buildSearchAPI('tasks').registerContentType(makeDef('tasks'))
    searchHarness.calls.multiQuery.mockResolvedValue([
      { hits: [{ key: 'd1', document: {}, score: 0.9 }], total: 1, diagnostics: { strategy: 'hybrid', durationMs: 5 } },
    ])
    const result = await crossTableSearch('hello')
    expect(result.meta.partial).toBeUndefined()
    expect(result.meta.tables).toEqual([{ table: 'bakin_tasks', hits: 1, took_ms: 5 }])
  })

  it('crossTableSearch returns fallback when search adapter is unavailable', async () => {
    searchHarness.setAvailable(false)

    const result = await crossTableSearch('hello')

    expect(result.meta.source).toBe('unavailable')
    expect(result.results).toEqual([])
  })

  it('crossTableSearch queries single table by name', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const result = await crossTableSearch('build', { table: 'tasks' })

    expect(searchHarness.calls.query).toHaveBeenCalledWith(
      'bakin_tasks',
      expect.objectContaining({ text: 'build', limit: 20 }),
    )
    expect(result.meta.source).toBe('search')
    expect(result.results).toHaveLength(1)
  })

  it('crossTableSearch resolves pluginId to table name', async () => {
    const api = buildSearchAPI('my-plugin')
    api.registerContentType(makeDef('widgets'))

    await crossTableSearch('test', { table: 'my-plugin' })

    expect(searchHarness.calls.query).toHaveBeenCalledWith(
      'bakin_widgets',
      expect.objectContaining({ text: 'test' }),
    )
  })

  it('crossTableSearch returns empty for unknown table', async () => {
    const result = await crossTableSearch('test', { table: 'nonexistent' })

    expect(result.results).toEqual([])
    expect(result.meta.source).toBe('search')
  })

  it('crossTableSearch queries all tables when no table specified', async () => {
    const api1 = buildSearchAPI('tasks')
    api1.registerContentType(makeDef('tasks'))
    const api2 = buildSearchAPI('assets')
    api2.registerContentType(makeDef('assets'))

    searchHarness.calls.multiQuery.mockResolvedValue([
      {
        hits: [{ key: 'd1', document: {}, score: 0.9 }],
        total: 1,
        diagnostics: { strategy: 'hybrid', durationMs: 5 },
      },
      {
        hits: [{ key: 'd2', document: {}, score: 0.8 }],
        total: 1,
        diagnostics: { strategy: 'hybrid', durationMs: 4 },
      },
    ])

    const result = await crossTableSearch('hello')

    // Each table now gets the full limit as its candidate pool; the global
    // top-N is taken from the merged results (was ceil(limit/tables) = 10).
    expect(searchHarness.calls.multiQuery).toHaveBeenCalledWith(
      [
        expect.objectContaining({ table: 'bakin_tasks', query: expect.objectContaining({ text: 'hello', limit: 20 }) }),
        expect.objectContaining({ table: 'bakin_assets', query: expect.objectContaining({ text: 'hello', limit: 20 }) }),
      ],
    )
    expect(result.results).toHaveLength(2)
    expect(result.meta.source).toBe('search')
  })

  it('crossTableSearch paginates the merged ordering and merges facet buckets', async () => {
    const api1 = buildSearchAPI('tasks')
    api1.registerContentType(makeDef('tasks'))
    const api2 = buildSearchAPI('assets')
    api2.registerContentType(makeDef('assets'))

    searchHarness.calls.multiQuery.mockResolvedValue([
      {
        hits: [
          { key: 't1', document: {}, score: 0.9 },
          { key: 't2', document: {}, score: 0.7 },
        ],
        total: 2,
        facets: { kind: [{ value: 'doc', count: 2 }] },
        diagnostics: { strategy: 'hybrid', durationMs: 5 },
      },
      {
        hits: [{ key: 'a1', document: {}, score: 0.8 }],
        total: 1,
        facets: { kind: [{ value: 'doc', count: 1 }, { value: 'image', count: 1 }] },
        diagnostics: { strategy: 'hybrid', durationMs: 4 },
      },
    ])

    const result = await crossTableSearch('hello', { limit: 2, offset: 1, facets: ['kind'] })

    // Candidate pool covers the page window (limit + offset) per table, and
    // facets ride each per-table query.
    expect(searchHarness.calls.multiQuery).toHaveBeenCalledWith([
      expect.objectContaining({ query: expect.objectContaining({ limit: 3, facets: ['kind'] }) }),
      expect.objectContaining({ query: expect.objectContaining({ limit: 3, facets: ['kind'] }) }),
    ])
    // Merged ordering: t1 (0.9), a1 (0.8), t2 (0.7) → offset 1, limit 2.
    expect(result.results.map((r) => r.id)).toEqual(['a1', 't2'])
    // Facet buckets sum across tables.
    expect(result.aggregations).toEqual({ kind: [{ value: 'doc', count: 3 }, { value: 'image', count: 1 }] })
  })

  // ── getSearchHealth with index health (#74) ────────────────────────

  it('getSearchHealth maps per-leg health into indexHealth', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    searchHarness.setTableStats('bakin_tasks', { table: 'bakin_tasks', documents: 42 })
    searchHarness.setLegHealth('bakin_tasks', [
      { leg: 'full_text', state: 'ready', indexedCount: 42 },
      { leg: 'embeddings', state: 'building', indexedCount: 12 },
    ])

    const health = await getSearchHealth()

    expect(health.enabled).toBe(true)
    expect(health.tables).toHaveLength(1)
    expect(health.tables[0]!.legs).toEqual([
      { name: 'full_text', totalIndexed: 42, rebuilding: false },
      { name: 'embeddings', totalIndexed: 12, rebuilding: true },
    ])
    expect(health.tables[0]!.logical).toBe('bakin_tasks')
    expect(health.tables[0]!.docCount).toBe(42)
    expect(health.tables[0]!.healthy).toBe(true)
  })

  it('getSearchHealth sets healthy false when a leg reports an error', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    searchHarness.setTableStats('bakin_tasks', { table: 'bakin_tasks', documents: 10 })
    searchHarness.setLegHealth('bakin_tasks', [
      { leg: 'embeddings', state: 'error', indexedCount: 0, error: 'model missing' },
    ])

    const health = await getSearchHealth()

    expect(health.tables[0]!.healthy).toBe(false)
    expect(health.tables[0]!.legs[0]!.error).toBe('model missing')
  })

  it('getSearchHealth defaults to healthy when leg health is empty', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    searchHarness.setTableStats('bakin_tasks', { table: 'bakin_tasks', documents: 5 })
    searchHarness.setLegHealth('bakin_tasks', [])

    const health = await getSearchHealth()

    expect(health.tables[0]!.docCount).toBe(5)
    expect(health.tables[0]!.legs).toEqual([])
    expect(health.tables[0]!.healthy).toBe(true)
  })

  describe('registry-row lifecycle', () => {
    it('purgeContentType removes the search_tables registry row and outbox rows', async () => {
      const api = buildSearchAPI('zombie')
      api.registerContentType(makeDef('zombie'))
      await createRegisteredTables()
      expect(tableStatus('bakin_zombie')).not.toBeNull()

      enqueueIndex('bakin_zombie', 'k1', { title: 'stale' })
      const before = outboxStats().pending

      await purgeContentType('zombie')

      // In-memory registration gone, registry row gone, journal purged —
      // nothing left to resurrect the table on the next rebuild pass.
      expect(getContentTypes().has('bakin_zombie')).toBe(false)
      expect(tableStatus('bakin_zombie')).toBeNull()
      expect(outboxStats().pending).toBe(before - 1)
    })

    it('sweepOrphanRegistryRows drops rows whose content type has no live registrant', async () => {
      const api = buildSearchAPI('keeper')
      api.registerContentType(makeDef('keeper'))
      buildSearchAPI('gone-plugin').registerContentType(makeDef('gone'))
      await createRegisteredTables()
      const gonePhysical = tableStatus('bakin_gone')!.physical
      enqueueIndex('bakin_gone', 'k1', { title: 'stale' })

      // Simulate the leak: the plugin was removed without purge — its
      // in-memory registration is gone, the registry row survives.
      resetSearchRegistry()
      const api2 = buildSearchAPI('keeper')
      api2.registerContentType(makeDef('keeper'))

      const removed = await sweepOrphanRegistryRows()

      expect(removed).toEqual(['bakin_gone'])
      expect(tableStatus('bakin_gone')).toBeNull()
      expect(searchHarness.calls.tablesDrop).toHaveBeenCalledWith(gonePhysical)
      // registered row untouched
      expect(tableStatus('bakin_keeper')).not.toBeNull()
    })

    it('sweepOrphanRegistryRows also drops a half-migrated green physical', async () => {
      buildSearchAPI('gone-plugin').registerContentType(makeDef('gone'))
      await createRegisteredTables()
      const { openNamedDb } = require('../../packages/core/src/storage/db') as typeof import('../../packages/core/src/storage/db')
      const store = openNamedDb('search', () => join(testDir, 'search.db'))
      store.db().prepare("UPDATE search_tables SET state = 'migrating', migrating_to = 'bakin_gone_v1_deadbeef', migration_phase = 'parked' WHERE logical = 'bakin_gone'").run()

      resetSearchRegistry()
      const removed = await sweepOrphanRegistryRows()

      expect(removed).toEqual(['bakin_gone'])
      expect(searchHarness.calls.tablesDrop).toHaveBeenCalledWith('bakin_gone_v1_deadbeef')
      expect(tableStatus('bakin_gone')).toBeNull()
    })
  })

  it('getSearchHealth reports freshness and numeric backlog per table', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))
    await createRegisteredTables() // registry row → lastRebuildAt
    const physical = tableStatus('bakin_tasks')!.physical

    searchHarness.setTableStats(physical, { table: physical, documents: 5 })
    searchHarness.setLegHealth(physical, [
      { leg: 'full_text', state: 'ready', indexedCount: 5 },
      { leg: 'embeddings', state: 'building', indexedCount: 2, pendingCount: 3 },
    ])
    enqueueIndex('bakin_tasks', 'k9', { title: 'queued' })

    const health = await getSearchHealth()
    const table = health.tables.find((t) => t.logical === 'bakin_tasks')!

    expect(table.journalPending).toBe(1)
    expect(table.lastRebuildAt).toBeGreaterThan(0)
    // no journal ack yet — freshness falls back to the registry transition
    expect(table.lastIndexedAt).toBe(table.lastRebuildAt)
    expect(table.legs.find((l) => l.name === 'embeddings')?.pending).toBe(3)
  })

  it('getSearchHealth returns enabled false when search adapter is unavailable', async () => {
    searchHarness.setAvailable(false)

    const health = await getSearchHealth()

    expect(health.enabled).toBe(false)
    expect(health.tables).toEqual([])
  })
})

describe('rebuild pass semantics (2026-07-21 redesign)', () => {
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

  function makeDef(table: string) {
    return {
      table,
      schemaVersion: 1,
      schema: { title: { type: 'text' as const } },
      searchableFields: ['title'],
      embeddingTemplate: '{{title}}',
      facets: [],
      reindex: async function* () { yield { key: 'k1', doc: { title: 'row' } } },
      verifyExists: async () => true,
    }
  }

  it('overlapping rebuild calls single-flight into ONE pass', async () => {
    buildSearchAPI('sf-plugin').registerContentType(makeDef('sfone'))
    await createRegisteredTables()

    const first = rebuildRegisteredTables(undefined, { force: true })
    const second = rebuildRegisteredTables(undefined, { force: true })
    // The second call attaches to the running pass — same promise, no
    // stacked generations (the 5-generations-of-team incident).
    expect(second).toBe(first)
    await first
  })

  it('default (repair) pass leaves a healthy table completely untouched', async () => {
    buildSearchAPI('rp-plugin').registerContentType(makeDef('rpone'))
    await createRegisteredTables()
    const before = tableStatus('bakin_rpone')!.physical

    const outcomes = await rebuildRegisteredTables('bakin_rpone')

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].result).toBe('unchanged')
    expect(tableStatus('bakin_rpone')!.physical).toBe(before)
  })

  it('repair pass regenerates a table whose physical vanished engine-side (post-nuke)', async () => {
    buildSearchAPI('nk-plugin').registerContentType(makeDef('nkone'))
    await createRegisteredTables()
    const before = tableStatus('bakin_nkone')!.physical

    // Simulate the engine data-dir nuke: table gone, registry row intact.
    await searchHarness.adapter.tables.drop(before)
    mock.clearAllMocks()

    const outcomes = await rebuildRegisteredTables('bakin_nkone')

    expect(outcomes[0].result).toMatch(/migrated|created/)
    const after = tableStatus('bakin_nkone')!
    expect(after.state).toBe('active')
    expect(after.physical).not.toBe(before)
    expect(await searchHarness.adapter.tables.stats(after.physical)).not.toBeNull()
  })

  it('force pass mints a fresh generation even for a healthy table', async () => {
    buildSearchAPI('fc-plugin').registerContentType(makeDef('fcone'))
    await createRegisteredTables()
    const before = tableStatus('bakin_fcone')!.physical

    const outcomes = await rebuildRegisteredTables('bakin_fcone', { force: true })

    expect(outcomes[0].result).toBe('migrated')
    expect(tableStatus('bakin_fcone')!.physical).not.toBe(before)
  })

  it('the migration pump resumes a parked migration to completion', async () => {
    buildSearchAPI('pp-plugin').registerContentType(makeDef('ppone'))
    await createRegisteredTables()
    const live = tableStatus('bakin_ppone')!.physical

    // Hand-park a migration toward a recorded green (the crash/park shape).
    const { openNamedDb } = require('../../packages/core/src/storage/db') as typeof import('../../packages/core/src/storage/db')
    const store = openNamedDb('search', () => join(testDir, 'search.db'))
    const green = 'bakin_ppone_v1_feedf00d'
    store.db().prepare(
      "UPDATE search_tables SET state = 'migrating', migrating_to = ?, migrating_fp = 'feedf00d-full', migration_phase = 'parked' WHERE logical = 'bakin_ppone'",
    ).run(green)

    const outcomes = await pumpParkedMigrations({ convergePollMs: 20, zeroProgressParkMs: 200 })

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toEqual({ logical: 'bakin_ppone', result: 'migrated' })
    const after = tableStatus('bakin_ppone')!
    expect(after.state).toBe('active')
    expect(after.physical).toBe(green)
    // The old live physical was dropped after the flip.
    expect(await searchHarness.adapter.tables.stats(live)).toBeNull()
  })

  it('the pump is a no-op when nothing is parked', async () => {
    buildSearchAPI('np-plugin').registerContentType(makeDef('npone'))
    await createRegisteredTables()
    expect(await pumpParkedMigrations()).toEqual([])
  })
})
