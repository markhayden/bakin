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

mock.module('@/core/content-dir', () => ({
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
          reranker: { enabled: true, provider: 'termite', model: 'mixedbread-ai/mxbai-rerank-base-v1', threshold: 0.0 },
        },
        embedders: {
          default: { provider: 'termite', model: 'BAAI/bge-small-en-v1.5' },
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
  reindexContentTypes,
  crossTableSearch,
  getSearchHealth,
} from '@/core/search-registry'
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

  it('maintenance.resetContentType drops and recreates the plugin table', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))
    await createRegisteredTables()
    searchHarness.calls.tablesCreate.mockClear()

    await api.maintenance!.resetContentType()

    expect(searchHarness.calls.tablesDrop).toHaveBeenCalledWith('bakin_tasks')
    expect(searchHarness.calls.tablesCreate).toHaveBeenCalledWith(
      'bakin_tasks',
      expect.objectContaining({ fields: expect.objectContaining({ title: { type: 'text' } }) }),
    )
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
      'bakin_tasks',
      expect.objectContaining({
        indexes: [
          expect.objectContaining({
            name: 'embeddings',
            kind: 'vector',
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
      'bakin_assets',
      expect.objectContaining({
        indexes: [
          expect.objectContaining({
            name: 'assets_text',
            kind: 'vector',
            template: '{{description}} {{tags}}',
            embedderRef: 'default',
            chunker: { enabled: true, targetTokens: 200, overlapTokens: 25 },
          }),
          expect.objectContaining({
            name: 'assets_visual',
            kind: 'vector',
            mediaUrlField: 'image_url',
            embedderRef: 'visual',
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
      'bakin_broken',
      expect.anything(),
    )
    expect(result.failures).toEqual([
      { table: 'bakin_broken', pluginId: 'broken', error: 'bad config' },
    ])
  })

  it('query returns fallback when no content type registered', async () => {
    const api = buildSearchAPI('orphan-plugin')
    const result = await api.query({ q: 'test' })

    expect(result.meta.source).toBe('fallback')
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
      'bakin_tasks',
      expect.objectContaining({ adapterOptions: expect.objectContaining({ description: expect.stringContaining('tasks') }) }),
    )
    expect(searchHarness.calls.tablesCreate).toHaveBeenCalledWith(
      'bakin_assets',
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

  // ── reindexContentTypes ─────────────────────────────────────────────

  it('reindexContentTypes indexes all docs via batchIndex', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType({
      ...makeDef('tasks'),
      reindex: async function* () {
        yield { key: 'k1', doc: { title: 'one' } }
        yield { key: 'k2', doc: { title: 'two' } }
        yield { key: 'k3', doc: { title: 'three' } }
      },
    })

    const results = await reindexContentTypes()

    expect(results).toHaveLength(1)
    expect(results[0]!.table).toBe('bakin_tasks')
    expect(results[0]!.indexed).toBe(3)
    expect(searchHarness.calls.documentsBatchIndex).toHaveBeenCalledWith('bakin_tasks', [
      { key: 'k1', doc: { title: 'one' } },
      { key: 'k2', doc: { title: 'two' } },
      { key: 'k3', doc: { title: 'three' } },
    ])
  })

  it('reindexContentTypes broadcasts start and complete events', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await reindexContentTypes()

    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'reindex.start', table: 'bakin_tasks' }),
    )
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'reindex.complete', table: 'bakin_tasks', indexed: 1 }),
    )
  })

  it('reindexContentTypes filters by table name', async () => {
    const api1 = buildSearchAPI('tasks')
    api1.registerContentType(makeDef('tasks'))
    const api2 = buildSearchAPI('assets')
    api2.registerContentType(makeDef('assets'))

    const results = await reindexContentTypes({ table: 'tasks' })

    expect(results).toHaveLength(1)
    expect(results[0]!.table).toBe('bakin_tasks')
  })

  it('reindexContentTypes calls rebuildIndexes when rebuild=true', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await reindexContentTypes({ rebuild: true })

    expect(searchHarness.calls.tablesRebuildIndexes).toHaveBeenCalledWith('bakin_tasks')
  })

  it('reindexContentTypes handles generator errors gracefully', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType({
      ...makeDef('tasks'),
      reindex: async function* () {
        yield* []
        throw new Error('boom')
      },
    })

    const results = await reindexContentTypes()

    expect(results).toHaveLength(1)
    expect(results[0]!.error).toContain('boom')
    expect(results[0]!.indexed).toBe(0)
  })

  // ── enrichment audit (#74) ──────────────────────────────────────────

  it('reindexContentTypes includes enrichment status when healthy', async () => {
    searchHarness.setTableHealth('bakin_tasks', {
      table: 'bakin_tasks',
      status: 'ok',
      details: {
        indexes: [
          { name: 'search', type: 'full_text', totalIndexed: 1, walBacklog: 0, rebuilding: false },
          { name: 'embeddings', type: 'embeddings', totalIndexed: 1, walBacklog: 0, rebuilding: false },
        ],
        healthy: true,
      },
    })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes()

    expect(results[0]!.enrichment).toBeDefined()
    expect(results[0]!.enrichment!.healthy).toBe(true)
    expect(results[0]!.enrichment!.indexes).toHaveLength(2)
    expect(searchHarness.calls.tablesGetHealth).toHaveBeenCalledWith('bakin_tasks')
  })

  it('reindexContentTypes includes enrichment errors when unhealthy', async () => {
    searchHarness.setTableHealth('bakin_tasks', {
      table: 'bakin_tasks',
      status: 'warn',
      details: {
        indexes: [
          { name: 'embeddings', type: 'embeddings', totalIndexed: 0, walBacklog: 0, rebuilding: false, error: 'model not found' },
        ],
        healthy: false,
      },
    })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes()

    expect(results[0]!.enrichment).toBeDefined()
    expect(results[0]!.enrichment!.healthy).toBe(false)
    expect(results[0]!.enrichment!.indexes[0]!.error).toBe('model not found')
  })

  it('reindexContentTypes omits enrichment when getIndexHealth returns null', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes()

    expect(results[0]!.enrichment).toBeUndefined()
    // Should not crash — enrichment is best-effort
    expect(results[0]!.indexed).toBe(1)
  })

  it('reindexContentTypes broadcasts reindex.complete before enrichment audit', async () => {
    searchHarness.setTableHealth('bakin_tasks', {
      table: 'bakin_tasks',
      status: 'ok',
      details: {
        indexes: [{ name: 'embeddings', type: 'embeddings', totalIndexed: 1, walBacklog: 0, rebuilding: false }],
        healthy: true,
      },
    })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await reindexContentTypes()

    // reindex.complete should fire before the enrichment audit runs —
    // verify it was called (existing behavior preserved)
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'reindex.complete', table: 'bakin_tasks' }),
    )
  })

  // ── verify mode (#74) ───────────────────────────────────────────────

  it('reindexContentTypes with verify=true checks table doc count', async () => {
    searchHarness.setTableStats('bakin_tasks', { table: 'bakin_tasks', documents: 1 })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes({ verify: true })

    expect(results[0]!.verified).toBe(1)
    expect(results[0]!.verifyDiscrepancy).toBe(0)
    expect(searchHarness.calls.tablesStats).toHaveBeenCalledWith('bakin_tasks')
  })

  it('reindexContentTypes with verify=true reports discrepancy', async () => {
    searchHarness.setTableStats('bakin_tasks', { table: 'bakin_tasks', documents: 0 })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes({ verify: true })

    expect(results[0]!.verified).toBe(0)
    expect(results[0]!.verifyDiscrepancy).toBe(1)
  })

  it('reindexContentTypes without verify does not check doc count', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes()

    expect(results[0]!.verified).toBeUndefined()
    expect(searchHarness.calls.tablesStats).not.toHaveBeenCalled()
  })

  it('reindexContentTypes verify handles getTableStats errors gracefully', async () => {
    searchHarness.calls.tablesStats.mockRejectedValueOnce(new Error('stats failed'))

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes({ verify: true })

    // Should not crash — verify is best-effort
    expect(results[0]!.indexed).toBe(1)
    expect(results[0]!.verified).toBeUndefined()
  })

  it('reindexContentTypes runs enrichment audit even when batchIndex returns 0', async () => {
    searchHarness.calls.documentsBatchIndex.mockResolvedValue({ indexed: 0, failed: [] })
    searchHarness.setTableHealth('bakin_tasks', {
      table: 'bakin_tasks',
      status: 'warn',
      details: {
        indexes: [
          { name: 'embeddings', type: 'embeddings', totalIndexed: 0, walBacklog: 5, rebuilding: false },
        ],
        healthy: false,
      },
    })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes()

    expect(results[0]!.indexed).toBe(0)
    expect(results[0]!.enrichment).toBeDefined()
    expect(results[0]!.enrichment!.healthy).toBe(false)
    // verify skipped when indexed === 0
    expect(results[0]!.verified).toBeUndefined()
    expect(searchHarness.calls.tablesStats).not.toHaveBeenCalled()
  })

  it('reindexContentTypes populates both enrichment and verify fields together', async () => {
    searchHarness.setTableHealth('bakin_tasks', {
      table: 'bakin_tasks',
      status: 'warn',
      details: {
        indexes: [
          { name: 'embeddings', type: 'embeddings', totalIndexed: 1, walBacklog: 3, rebuilding: false },
        ],
        healthy: false,
      },
    })
    searchHarness.setTableStats('bakin_tasks', { table: 'bakin_tasks', documents: 1 })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes({ verify: true })

    expect(results[0]!.enrichment).toBeDefined()
    expect(results[0]!.enrichment!.healthy).toBe(false)
    expect(results[0]!.verified).toBe(1)
    expect(results[0]!.verifyDiscrepancy).toBe(0)
  })

  // ── crossTableSearch ────────────────────────────────────────────────

  it('crossTableSearch returns fallback when search adapter is unavailable', async () => {
    searchHarness.setAvailable(false)

    const result = await crossTableSearch('hello')

    expect(result.meta.source).toBe('fallback')
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

  it('getSearchHealth includes indexHealth when available', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    searchHarness.setTableStats('bakin_tasks', { table: 'bakin_tasks', documents: 42 })
    searchHarness.setTableHealth('bakin_tasks', {
      table: 'bakin_tasks',
      status: 'ok',
      details: {
        indexes: [
          { name: 'search', type: 'full_text', totalIndexed: 42, walBacklog: 0, rebuilding: false },
          { name: 'embeddings', type: 'embeddings', totalIndexed: 42, walBacklog: 0, rebuilding: false },
        ],
        healthy: true,
      },
    })

    const health = await getSearchHealth()

    expect(health.enabled).toBe(true)
    expect(health.tables).toHaveLength(1)
    expect(health.tables[0]!.indexHealth).toBeDefined()
    expect(health.tables[0]!.indexHealth).toHaveLength(2)
    expect(health.tables[0]!.healthy).toBe(true)
  })

  it('getSearchHealth sets healthy false when indexes have errors', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    searchHarness.setTableStats('bakin_tasks', { table: 'bakin_tasks', documents: 10 })
    searchHarness.setTableHealth('bakin_tasks', {
      table: 'bakin_tasks',
      status: 'warn',
      details: {
        indexes: [
          { name: 'embeddings', type: 'embeddings', totalIndexed: 0, walBacklog: 0, rebuilding: false, error: 'model missing' },
        ],
        healthy: false,
      },
    })

    const health = await getSearchHealth()

    expect(health.tables[0]!.healthy).toBe(false)
    expect(health.tables[0]!.indexHealth![0]!.error).toBe('model missing')
  })

  it('getSearchHealth handles getIndexHealth returning null', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    searchHarness.setTableStats('bakin_tasks', { table: 'bakin_tasks', documents: 5 })

    const health = await getSearchHealth()

    expect(health.tables[0]!.stats).toEqual({ table: 'bakin_tasks', documents: 5 })
    expect(health.tables[0]!.indexHealth).toBeUndefined()
    // When index health unavailable, default to healthy (don't red-flag)
    expect(health.tables[0]!.healthy).toBe(true)
  })

  it('getSearchHealth returns enabled false when search adapter is unavailable', async () => {
    searchHarness.setAvailable(false)

    const health = await getSearchHealth()

    expect(health.enabled).toBe(false)
    expect(health.tables).toEqual([])
  })
})
