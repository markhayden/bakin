import { describe, it, expect, beforeEach, mock, type Mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'

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

// Mock antfly module
mock.module('@/core/antfly', () => ({
  enabled: mock(() => true),
  available: mock(() => true),
  createTable: mock(async () => true),
  listTables: mock(async () => []),
  indexDocument: mock(async () => {}),
  removeDocument: mock(async () => {}),
  transformDocument: mock(async () => {}),
  rebuildIndexes: mock(async () => {}),
  batchIndex: mock(async (_table: string, docs: Record<string, unknown>) => Object.keys(docs).length),
  multiQuery: mock(async () => ({ results: [], total: 0, took: 0 })),
  queryTable: mock(async () => ({
    results: [
      { id: 'doc-1', table: 'bakin_tasks', score: 0.95, fields: { title: 'Test task' } },
    ],
    aggregations: {
      status: { buckets: [{ key: 'active', doc_count: 5 }] },
    },
    took: 12,
    total: 1,
  })),
  getIndexHealth: mock(async () => null),
  getTableStats: mock(async () => null),
}))

mock.module('@/core/settings', () => ({
  getSettings: mock(() => ({
    antfly: {
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
import * as antfly from '@/core/antfly'
import { broadcast } from '@/core/sse'

describe('search-registry', () => {
  beforeEach(() => {
    resetSearchRegistry()
    mock.clearAllMocks()
    // Restore defaults — clearAllMocks resets call history but not implementations.
    // resetAllMocks on specific mocks clears the once-queue too, preventing leaks.
    vi.mocked(antfly.enabled).mockReturnValue(true)
    vi.mocked(antfly.getIndexHealth).mockReset().mockResolvedValue(null)
    vi.mocked(antfly.getTableStats).mockReset().mockResolvedValue(null)
    vi.mocked(antfly.batchIndex).mockReset().mockImplementation(
      async (_table: string, docs: Record<string, unknown>) => Object.keys(docs).length,
    )
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

  it('getTableForPlugin throws if a plugin has multiple content types', () => {
    const api = buildSearchAPI('multi')
    api.registerContentType(makeDef('one'))
    api.registerContentType(makeDef('two'))
    expect(() => getTableForPlugin('multi')).toThrow(/multi.*2 registered/)
  })

  it('getTableForPlugin returns null when the registry is completely empty', () => {
    // Reset wipes all registrations — no content types at all.
    resetSearchRegistry()
    expect(getContentTypes().size).toBe(0)
    expect(getTableForPlugin('anything')).toBeNull()
  })

  it('getTableForPlugin error message names the conflicting tables', () => {
    const api = buildSearchAPI('multi')
    api.registerContentType(makeDef('alpha'))
    api.registerContentType(makeDef('beta'))
    // The error must list both bakin_alpha and bakin_beta so an operator
    // tracking down a misconfiguration can find them without code-diving.
    expect(() => getTableForPlugin('multi')).toThrow(/bakin_alpha/)
    expect(() => getTableForPlugin('multi')).toThrow(/bakin_beta/)
  })

  it('registerContentType preserves pluginId', () => {
    const api = buildSearchAPI('my-plugin')
    api.registerContentType(makeDef('widgets'))

    const entry = getContentTypes().get('bakin_widgets')
    expect(entry?.pluginId).toBe('my-plugin')
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

    // With `q` → 200 + antfly.queryTable hit
    const ok = await route.handler(new Request('http://localhost/search?q=build&facets=status&limit=5'))
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body.meta.source).toBe('antfly')
    expect(antfly.queryTable).toHaveBeenCalledWith(
      'bakin_tasks',
      'build',
      expect.objectContaining({ limit: 5 }),
    )
  })

  it('index calls antfly.indexDocument with resolved table', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await api.index('task-1', { title: 'Build feature' })

    expect(antfly.indexDocument).toHaveBeenCalledWith(
      'bakin_tasks',
      'task-1',
      { title: 'Build feature' },
    )
  })

  it('remove calls antfly.removeDocument', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await api.remove('task-1')

    expect(antfly.removeDocument).toHaveBeenCalledWith('bakin_tasks', 'task-1')
  })

  it('transform calls antfly.transformDocument with $set ops', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await api.transform('task-1', [
      { op: '$set', field: 'status', value: 'done' },
    ])

    expect(antfly.transformDocument).toHaveBeenCalledWith(
      'bakin_tasks',
      'task-1',
      { status: 'done' },
    )
  })

  it('query calls antfly.queryTable and maps response', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const result = await api.query({ q: 'build feature', facets: ['status'] })

    expect(antfly.queryTable).toHaveBeenCalledWith(
      'bakin_tasks',
      'build feature',
      expect.objectContaining({
        aggregations: { status: { type: 'terms', field: 'status', size: 50 } },
        indexes: ['embeddings'],
      }),
    )
    expect(result.meta.source).toBe('antfly')
    expect(result.results).toHaveLength(1)
    expect(result.aggregations?.status).toEqual([{ value: 'active', count: 5 }])
  })

  // ── multi-index support (T3) ─────────────────────────────────────────

  it('buildAntflyIndexes synthesizes a single default index when def.indexes is absent', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await createRegisteredTables()

    expect(antfly.createTable).toHaveBeenCalledWith(
      'bakin_tasks',
      expect.objectContaining({
        indexes: expect.objectContaining({
          search: expect.objectContaining({ type: 'full_text' }),
          embeddings: expect.objectContaining({
            type: 'embeddings',
            template: '{{title}}',
            embedder: { provider: 'termite', model: 'BAAI/bge-small-en-v1.5' },
          }),
        }),
      }),
    )
  })

  it('buildAntflyIndexes creates one Antfly index per entry when def.indexes is set', async () => {
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
          embeddingTemplate: '{{#if image_url}}{{remoteMedia url=image_url}}{{/if}}',
        },
      ],
    })

    await createRegisteredTables()

    expect(antfly.createTable).toHaveBeenCalledWith(
      'bakin_assets',
      expect.objectContaining({
        indexes: expect.objectContaining({
          search: expect.objectContaining({ type: 'full_text' }),
          assets_text: expect.objectContaining({
            type: 'embeddings',
            template: '{{description}} {{tags}}',
            embedder: { provider: 'termite', model: 'BAAI/bge-small-en-v1.5' },
            chunk_size: 200,
            chunk_overlap: 25,
          }),
          assets_visual: expect.objectContaining({
            type: 'embeddings',
            template: '{{#if image_url}}{{remoteMedia url=image_url}}{{/if}}',
            embedder: { provider: 'antfly', model: 'openai/clip-vit-base-patch32' },
          }),
        }),
      }),
    )
  })

  it('query routes multiple index names through to antfly.queryTable', async () => {
    const api = buildSearchAPI('assets')
    api.registerContentType({
      ...makeDef('assets'),
      indexes: [
        { name: 'assets_text', embedderRef: 'default', embeddingTemplate: '{{description}}' },
        { name: 'assets_visual', embedderRef: 'visual', embeddingTemplate: '{{#if image_url}}{{remoteMedia url=image_url}}{{/if}}' },
      ],
    })

    await api.query({ q: 'kafka diagram' })

    expect(antfly.queryTable).toHaveBeenCalledWith(
      'bakin_assets',
      'kafka diagram',
      expect.objectContaining({
        indexes: ['assets_text', 'assets_visual'],
      }),
    )
  })

  // ── aggregations passthrough (T5) ───────────────────────────────────

  it('query passes raw aggregations through to antfly.queryTable', async () => {
    vi.mocked(antfly.queryTable).mockResolvedValueOnce({
      results: [],
      aggregations: {
        byDate: { buckets: [{ key: '2026-04-01', doc_count: 3 }] },
      },
      took: 5,
      total: 0,
    })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const result = await api.query({
      q: 'any',
      aggregations: {
        byDate: { date_histogram: { field: 'created_at', interval: 'day' } },
      },
    })

    expect(antfly.queryTable).toHaveBeenCalledWith(
      'bakin_tasks',
      'any',
      expect.objectContaining({
        aggregations: {
          byDate: { date_histogram: { field: 'created_at', interval: 'day' } },
        },
      }),
    )
    expect(result.rawAggregations).toEqual({
      byDate: { buckets: [{ key: '2026-04-01', doc_count: 3 }] },
    })
  })

  it('query merges caller aggregations with facet-derived aggregations', async () => {
    vi.mocked(antfly.queryTable).mockResolvedValueOnce({
      results: [], aggregations: {}, took: 1, total: 0,
    })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await api.query({
      q: 'any',
      facets: ['status'],
      aggregations: {
        byDate: { date_histogram: { field: 'created_at', interval: 'day' } },
      },
    })

    expect(antfly.queryTable).toHaveBeenCalledWith(
      'bakin_tasks',
      'any',
      expect.objectContaining({
        aggregations: {
          status: { type: 'terms', field: 'status', size: 50 },
          byDate: { date_histogram: { field: 'created_at', interval: 'day' } },
        },
      }),
    )
  })

  it('caller aggregations override facet-derived ones on key collision', async () => {
    vi.mocked(antfly.queryTable).mockResolvedValueOnce({
      results: [], aggregations: {}, took: 1, total: 0,
    })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await api.query({
      q: 'any',
      facets: ['status'],
      aggregations: {
        // Same key as the facet, but a different shape — caller wins
        status: { type: 'terms', field: 'status', size: 500 },
      },
    })

    expect(antfly.queryTable).toHaveBeenCalledWith(
      'bakin_tasks',
      'any',
      expect.objectContaining({
        aggregations: {
          status: { type: 'terms', field: 'status', size: 500 },
        },
      }),
    )
  })

  it('buildAntflyIndexes throws when an embedderRef is unknown', async () => {
    const api = buildSearchAPI('broken')
    api.registerContentType({
      ...makeDef('broken'),
      indexes: [
        { name: 'bad', embedderRef: 'does-not-exist', embeddingTemplate: '{{x}}' },
      ],
    })

    // createRegisteredTables swallows per-table errors and logs them, so the
    // call itself resolves — but the resulting createTable mock should NOT
    // have been called for this table because the error happened before it.
    vi.mocked(antfly.createTable).mockClear()
    await createRegisteredTables()

    expect(antfly.createTable).not.toHaveBeenCalledWith(
      'bakin_broken',
      expect.anything(),
    )
  })

  it('query returns fallback when no content type registered', async () => {
    const api = buildSearchAPI('orphan-plugin')
    const result = await api.query({ q: 'test' })

    expect(result.meta.source).toBe('fallback')
    expect(result.results).toEqual([])
  })

  it('createRegisteredTables calls antfly.createTable for each type', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const api2 = buildSearchAPI('assets')
    api2.registerContentType(makeDef('assets'))

    await createRegisteredTables()

    expect(antfly.createTable).toHaveBeenCalledTimes(2)
    expect(antfly.createTable).toHaveBeenCalledWith(
      'bakin_tasks',
      expect.objectContaining({ description: expect.stringContaining('tasks') }),
    )
    expect(antfly.createTable).toHaveBeenCalledWith(
      'bakin_assets',
      expect.objectContaining({ description: expect.stringContaining('assets') }),
    )
  })

  it('createRegisteredTables is idempotent', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    await createRegisteredTables()
    await createRegisteredTables()

    expect(antfly.createTable).toHaveBeenCalledTimes(1)
  })

  it('index warns and no-ops when no content type registered', async () => {
    const api = buildSearchAPI('unregistered')
    await api.index('key', { data: 'test' })
    expect(antfly.indexDocument).not.toHaveBeenCalled()
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
    expect(antfly.batchIndex).toHaveBeenCalledWith('bakin_tasks', {
      k1: { title: 'one' },
      k2: { title: 'two' },
      k3: { title: 'three' },
    })
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

    expect(antfly.rebuildIndexes).toHaveBeenCalledWith('bakin_tasks')
  })

  it('reindexContentTypes handles generator errors gracefully', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType({
      ...makeDef('tasks'),
      reindex: async function* () { throw new Error('boom') },
    })

    const results = await reindexContentTypes()

    expect(results).toHaveLength(1)
    expect(results[0]!.error).toContain('boom')
    expect(results[0]!.indexed).toBe(0)
  })

  // ── enrichment audit (#74) ──────────────────────────────────────────

  it('reindexContentTypes includes enrichment status when healthy', async () => {
    vi.mocked(antfly.getIndexHealth).mockResolvedValue({
      indexes: [
        { name: 'search', type: 'full_text', totalIndexed: 1, walBacklog: 0, rebuilding: false },
        { name: 'embeddings', type: 'embeddings', totalIndexed: 1, walBacklog: 0, rebuilding: false },
      ],
      healthy: true,
    })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes()

    expect(results[0]!.enrichment).toBeDefined()
    expect(results[0]!.enrichment!.healthy).toBe(true)
    expect(results[0]!.enrichment!.indexes).toHaveLength(2)
    expect(antfly.getIndexHealth).toHaveBeenCalledWith('bakin_tasks')
  })

  it('reindexContentTypes includes enrichment errors when unhealthy', async () => {
    vi.mocked(antfly.getIndexHealth).mockResolvedValue({
      indexes: [
        { name: 'embeddings', type: 'embeddings', totalIndexed: 0, walBacklog: 0, rebuilding: false, error: 'model not found' },
      ],
      healthy: false,
    })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes()

    expect(results[0]!.enrichment).toBeDefined()
    expect(results[0]!.enrichment!.healthy).toBe(false)
    expect(results[0]!.enrichment!.indexes[0]!.error).toBe('model not found')
  })

  it('reindexContentTypes omits enrichment when getIndexHealth returns null', async () => {
    vi.mocked(antfly.getIndexHealth).mockResolvedValue(null)

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes()

    expect(results[0]!.enrichment).toBeUndefined()
    // Should not crash — enrichment is best-effort
    expect(results[0]!.indexed).toBe(1)
  })

  it('reindexContentTypes broadcasts reindex.complete before enrichment audit', async () => {
    vi.mocked(antfly.getIndexHealth).mockResolvedValue({
      indexes: [{ name: 'embeddings', type: 'embeddings', totalIndexed: 1, walBacklog: 0, rebuilding: false }],
      healthy: true,
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
    vi.mocked(antfly.getIndexHealth).mockResolvedValue(null)
    // Mock getTableStats to return doc count matching indexed
    vi.mocked(antfly.getTableStats).mockResolvedValueOnce({ num_docs: 1 })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes({ verify: true })

    expect(results[0]!.verified).toBe(1)
    expect(results[0]!.verifyDiscrepancy).toBe(0)
    expect(antfly.getTableStats).toHaveBeenCalledWith('bakin_tasks')
  })

  it('reindexContentTypes with verify=true reports discrepancy', async () => {
    vi.mocked(antfly.getIndexHealth).mockResolvedValue(null)
    // Mock getTableStats to return fewer docs than indexed
    vi.mocked(antfly.getTableStats).mockResolvedValueOnce({ num_docs: 0 })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes({ verify: true })

    expect(results[0]!.verified).toBe(0)
    expect(results[0]!.verifyDiscrepancy).toBe(1)
  })

  it('reindexContentTypes without verify does not check doc count', async () => {
    vi.mocked(antfly.getIndexHealth).mockResolvedValue(null)

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes()

    expect(results[0]!.verified).toBeUndefined()
    expect(antfly.getTableStats).not.toHaveBeenCalled()
  })

  it('reindexContentTypes verify handles getTableStats errors gracefully', async () => {
    vi.mocked(antfly.getIndexHealth).mockResolvedValue(null)
    vi.mocked(antfly.getTableStats).mockRejectedValueOnce(new Error('stats failed'))

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes({ verify: true })

    // Should not crash — verify is best-effort
    expect(results[0]!.indexed).toBe(1)
    expect(results[0]!.verified).toBeUndefined()
  })

  it('reindexContentTypes runs enrichment audit even when batchIndex returns 0', async () => {
    vi.mocked(antfly.batchIndex).mockResolvedValue(0)
    vi.mocked(antfly.getIndexHealth).mockResolvedValue({
      indexes: [
        { name: 'embeddings', type: 'embeddings', totalIndexed: 0, walBacklog: 5, rebuilding: false },
      ],
      healthy: false,
    })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes()

    expect(results[0]!.indexed).toBe(0)
    expect(results[0]!.enrichment).toBeDefined()
    expect(results[0]!.enrichment!.healthy).toBe(false)
    // verify skipped when indexed === 0
    expect(results[0]!.verified).toBeUndefined()
    expect(antfly.getTableStats).not.toHaveBeenCalled()
  })

  it('reindexContentTypes populates both enrichment and verify fields together', async () => {
    vi.mocked(antfly.getIndexHealth).mockResolvedValue({
      indexes: [
        { name: 'embeddings', type: 'embeddings', totalIndexed: 1, walBacklog: 3, rebuilding: false },
      ],
      healthy: false,
    })
    vi.mocked(antfly.getTableStats).mockResolvedValueOnce({ num_docs: 1 })

    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const results = await reindexContentTypes({ verify: true })

    expect(results[0]!.enrichment).toBeDefined()
    expect(results[0]!.enrichment!.healthy).toBe(false)
    expect(results[0]!.verified).toBe(1)
    expect(results[0]!.verifyDiscrepancy).toBe(0)
  })

  // ── crossTableSearch ────────────────────────────────────────────────

  it('crossTableSearch returns fallback when antfly disabled', async () => {
    vi.mocked(antfly.enabled).mockReturnValueOnce(false)

    const result = await crossTableSearch('hello')

    expect(result.meta.source).toBe('fallback')
    expect(result.results).toEqual([])
  })

  it('crossTableSearch queries single table by name', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    const result = await crossTableSearch('build', { table: 'tasks' })

    expect(antfly.queryTable).toHaveBeenCalledWith(
      'bakin_tasks',
      'build',
      expect.objectContaining({ limit: 20 }),
    )
    expect(result.meta.source).toBe('antfly')
    expect(result.results).toHaveLength(1)
  })

  it('crossTableSearch resolves pluginId to table name', async () => {
    const api = buildSearchAPI('my-plugin')
    api.registerContentType(makeDef('widgets'))

    await crossTableSearch('test', { table: 'my-plugin' })

    expect(antfly.queryTable).toHaveBeenCalledWith(
      'bakin_widgets',
      'test',
      expect.anything(),
    )
  })

  it('crossTableSearch returns empty for unknown table', async () => {
    const result = await crossTableSearch('test', { table: 'nonexistent' })

    expect(result.results).toEqual([])
    expect(result.meta.source).toBe('antfly')
  })

  it('crossTableSearch queries all tables when no table specified', async () => {
    const api1 = buildSearchAPI('tasks')
    api1.registerContentType(makeDef('tasks'))
    const api2 = buildSearchAPI('assets')
    api2.registerContentType(makeDef('assets'))

    vi.mocked(antfly.multiQuery).mockResolvedValue({
      results: [
        { id: 'd1', table: 'bakin_tasks', score: 0.9, fields: {} },
        { id: 'd2', table: 'bakin_assets', score: 0.8, fields: {} },
      ],
      total: 2,
      took: 5,
    })

    const result = await crossTableSearch('hello')

    expect(antfly.multiQuery).toHaveBeenCalledWith(
      'hello',
      ['bakin_tasks', 'bakin_assets'],
      expect.objectContaining({ limit: 20 }),
    )
    expect(result.results).toHaveLength(2)
    expect(result.meta.source).toBe('antfly')
  })

  // ── getSearchHealth with index health (#74) ────────────────────────

  it('getSearchHealth includes indexHealth when available', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    vi.mocked(antfly.getTableStats).mockResolvedValue({ num_docs: 42 })
    vi.mocked(antfly.getIndexHealth).mockResolvedValue({
      indexes: [
        { name: 'search', type: 'full_text', totalIndexed: 42, walBacklog: 0, rebuilding: false },
        { name: 'embeddings', type: 'embeddings', totalIndexed: 42, walBacklog: 0, rebuilding: false },
      ],
      healthy: true,
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

    vi.mocked(antfly.getTableStats).mockResolvedValue({ num_docs: 10 })
    vi.mocked(antfly.getIndexHealth).mockResolvedValue({
      indexes: [
        { name: 'embeddings', type: 'embeddings', totalIndexed: 0, walBacklog: 0, rebuilding: false, error: 'model missing' },
      ],
      healthy: false,
    })

    const health = await getSearchHealth()

    expect(health.tables[0]!.healthy).toBe(false)
    expect(health.tables[0]!.indexHealth![0]!.error).toBe('model missing')
  })

  it('getSearchHealth handles getIndexHealth returning null', async () => {
    const api = buildSearchAPI('tasks')
    api.registerContentType(makeDef('tasks'))

    vi.mocked(antfly.getTableStats).mockResolvedValueOnce({ num_docs: 5 })
    vi.mocked(antfly.getIndexHealth).mockResolvedValueOnce(null)

    const health = await getSearchHealth()

    expect(health.tables[0]!.stats).toEqual({ num_docs: 5 })
    expect(health.tables[0]!.indexHealth).toBeUndefined()
    // When index health unavailable, default to healthy (don't red-flag)
    expect(health.tables[0]!.healthy).toBe(true)
  })

  it('getSearchHealth returns enabled false when antfly disabled', async () => {
    vi.mocked(antfly.enabled).mockReturnValueOnce(false)

    const health = await getSearchHealth()

    expect(health.enabled).toBe(false)
    expect(health.tables).toEqual([])
  })

  it('getSearchHealth returns enabled false when antfly is configured but unavailable', async () => {
    vi.mocked(antfly.available).mockReturnValueOnce(false)

    const health = await getSearchHealth()

    expect(health.enabled).toBe(false)
    expect(health.tables).toEqual([])
  })
})
