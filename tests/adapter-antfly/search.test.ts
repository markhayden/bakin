import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import type { SearchAdapter } from '@bakin/core/adapters/search'

const testDir = join(tmpdir(), `bakin-test-adapter-antfly-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly') }),
}))

type QueryResponse = {
  responses: Array<{ hits: { hits: unknown[]; total: number }; took: number }>
}

const mockGetStatus = mock(async () => ({ health: 'healthy' }))
const mockTablesList = mock(async () => [])
const mockTablesCreate = mock(async () => {})
const mockTablesDrop = mock(async () => {})
const mockTablesQuery = mock(async (): Promise<QueryResponse> => ({
  responses: [{ hits: { hits: [], total: 0 }, took: 0 }],
}))
const mockTablesBatch = mock(async () => ({ inserted: 1, deleted: 1 }))
const mockTablesScan = mock(async function* () {})
const mockIndexesList = mock(async () => ({}))
const mockIndexesCreate = mock(async () => {})
const mockIndexesDrop = mock(async () => {})
// multiQuery fans out as single global queries (client.query) — the NDJSON
// multiquery endpoint is broken at v0.2.0-rc.2 (bakin#456).
const mockGlobalQuery = mock(async (): Promise<{ hits: { hits: unknown[]; total: number }; took: number }> => ({
  hits: { hits: [], total: 0 },
  took: 0,
}))

const mockClientInstance = {
  getStatus: mockGetStatus,
  query: mockGlobalQuery,
  tables: {
    list: mockTablesList,
    create: mockTablesCreate,
    drop: mockTablesDrop,
    query: mockTablesQuery,
    batch: mockTablesBatch,
    scan: mockTablesScan,
  },
  indexes: {
    list: mockIndexesList,
    create: mockIndexesCreate,
    drop: mockIndexesDrop,
  },
}

mock.module('@antfly/sdk', () => ({
  AntflyClient: mock().mockImplementation(() => mockClientInstance),
  matchAll: mock(() => ({ match_all: {} })),
}))

const logger = {
  debug: mock(),
  info: mock(),
  warn: mock(),
  error: mock(),
}

const baseSettings = {
  enabled: true,
  url: 'http://localhost:3738',
  search: {
    strategy: 'rrf',
    defaultLimit: 20,
    reranker: {
      enabled: true,
      provider: 'antfly',
      model: 'mixedbread-ai/mxbai-rerank-base-v1',
    },
  },
  embedders: {
    default: { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5', dimension: 384 },
    visual: { provider: 'antfly', model: 'clip-vit-base-patch32', dimension: 512 },
  },
  chunking: { defaultTargetTokens: 200, defaultOverlapTokens: 25 },
}

const realFetch = globalThis.fetch
let adapters: SearchAdapter[] = []
let previousExternalRecheckDelay: string | undefined

async function createInitializedAdapter(settings: Record<string, unknown> = {}): Promise<SearchAdapter> {
  const { createAntflySearchAdapter } = await import('@bakin/adapter-antfly')
  const adapter = createAntflySearchAdapter()
  adapters.push(adapter)
  await adapter.initialize({
    contentDir: testDir,
    logger,
    settings: {
      ...baseSettings,
      ...settings,
      search: {
        ...baseSettings.search,
        ...((settings.search as Record<string, unknown> | undefined) ?? {}),
        reranker: {
          ...baseSettings.search.reranker,
          ...(((settings.search as { reranker?: Record<string, unknown> } | undefined)?.reranker) ?? {}),
        },
      },
    },
  })
  return adapter
}

function tableQueryRequest(index = 0): Record<string, unknown> {
  return (mockTablesQuery.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[index][1]
}

function globalQueryRequests(): Array<Record<string, unknown>> {
  return (mockGlobalQuery.mock.calls as unknown as Array<[Record<string, unknown>]>).map((c) => c[0])
}

describe('AntflySearchAdapter', () => {
  beforeEach(() => {
    adapters = []
    previousExternalRecheckDelay = process.env.BAKIN_ANTFLY_EXTERNAL_RECHECK_MS
    process.env.BAKIN_ANTFLY_EXTERNAL_RECHECK_MS = '0'
    mock.clearAllMocks()
    ;(globalThis as { fetch: typeof fetch }).fetch = mock(async () => (
      new Response(JSON.stringify({ health: 'healthy' }), { status: 200 })
    )) as unknown as typeof fetch

    mockGetStatus.mockClear()
    mockTablesList.mockClear()
    mockTablesCreate.mockClear()
    mockTablesDrop.mockClear()
    mockTablesQuery.mockClear()
    mockTablesQuery.mockImplementation(async () => ({ responses: [{ hits: { hits: [], total: 0 }, took: 0 }] }))
    mockTablesBatch.mockClear()
    mockTablesBatch.mockImplementation(async () => ({ inserted: 1, deleted: 1 }))
    mockIndexesList.mockClear()
    mockIndexesList.mockImplementation(async () => ({}))
    mockIndexesCreate.mockClear()
    mockIndexesDrop.mockClear()
    mockGlobalQuery.mockClear()
    mockGlobalQuery.mockImplementation(async () => ({ hits: { hits: [], total: 0 }, took: 0 }))
    logger.debug.mockClear()
    logger.info.mockClear()
    logger.warn.mockClear()
    logger.error.mockClear()
  })

  afterEach(async () => {
    for (const adapter of adapters) {
      await adapter.shutdown()
    }
    ;(globalThis as { fetch: typeof fetch }).fetch = realFetch
    if (previousExternalRecheckDelay === undefined) {
      delete process.env.BAKIN_ANTFLY_EXTERNAL_RECHECK_MS
    } else {
      process.env.BAKIN_ANTFLY_EXTERNAL_RECHECK_MS = previousExternalRecheckDelay
    }
  })

  it('attaches reranker config when enabled and rerankField is supplied', async () => {
    const adapter = await createInitializedAdapter()

    await adapter.query('bakin_tasks', {
      text: 'build feature',
      adapterOptions: { rerankField: 'description' },
    })

    const request = tableQueryRequest() as { reranker?: Record<string, unknown> }
    expect(request.reranker).toEqual({
      provider: 'antfly',
      model: 'mixedbread-ai/mxbai-rerank-base-v1',
      field: 'description',
    })
  })

  it('omits reranker when no rerankField is supplied', async () => {
    const adapter = await createInitializedAdapter()
    await adapter.query('bakin_tasks', { text: 'build feature' })

    const request = tableQueryRequest() as { reranker?: Record<string, unknown> }
    expect(request.reranker).toBeUndefined()
  })

  it('omits reranker when rerank is false or settings disable reranking', async () => {
    const adapter = await createInitializedAdapter()
    await adapter.query('bakin_tasks', {
      text: 'build feature',
      rerank: false,
      adapterOptions: { rerankField: 'description' },
    })
    expect((tableQueryRequest(0) as { reranker?: unknown }).reranker).toBeUndefined()

    const disabled = await createInitializedAdapter({ search: { reranker: { enabled: false } } })
    await disabled.query('bakin_tasks', {
      text: 'build feature',
      adapterOptions: { rerankField: 'description' },
    })
    expect((tableQueryRequest(1) as { reranker?: unknown }).reranker).toBeUndefined()
  })

  it('never sends threshold even when legacy settings carry one', async () => {
    // v0.1-era settings.json files may still contain reranker.threshold;
    // the v0.2 RerankerConfig has no such field — it must never reach the wire.
    const adapter = await createInitializedAdapter({ search: { reranker: { threshold: 0.4 } } })
    await adapter.query('bakin_tasks', {
      text: 'build feature',
      adapterOptions: { rerankField: 'description' },
    })

    const request = tableQueryRequest() as { reranker?: Record<string, unknown> }
    expect(request.reranker).toEqual({
      provider: 'antfly',
      model: 'mixedbread-ai/mxbai-rerank-base-v1',
      field: 'description',
    })
  })

  it('multiQuery fans out as single global queries with per-query reranker', async () => {
    const adapter = await createInitializedAdapter()
    await adapter.multiQuery([
      { table: 'bakin_tasks', query: { text: 'build', adapterOptions: { rerankField: 'description' } } },
      { table: 'bakin_assets', query: { text: 'build' } },
    ])

    // One client.query call per table — NOT the NDJSON multiquery endpoint,
    // which rejects its own framing at v0.2.0-rc.2 (bakin#456).
    const requests = globalQueryRequests() as Array<{ table: string; reranker?: Record<string, unknown> }>
    expect(requests).toHaveLength(2)
    expect(requests.find(r => r.table === 'bakin_tasks')?.reranker).toEqual({
      provider: 'antfly',
      model: 'mixedbread-ai/mxbai-rerank-base-v1',
      field: 'description',
    })
    expect(requests.find(r => r.table === 'bakin_assets')?.reranker).toBeUndefined()
  })

  it('multiQuery isolates per-table failures', async () => {
    mockGlobalQuery
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ hits: { hits: [{ _id: 'a1', _score: 1, _source: {} }], total: 1 }, took: 2 })

    const adapter = await createInitializedAdapter()
    const results = await adapter.multiQuery([
      { table: 'bakin_tasks', query: { text: 'x' } },
      { table: 'bakin_assets', query: { text: 'x' } },
    ])

    expect(results[0].total).toBe(0) // failed table -> empty result
    expect(results[1].total).toBe(1) // healthy table unaffected
  })

  it('maps rerank score into query result scoreBreakdown', async () => {
    mockTablesQuery.mockImplementationOnce(async () => ({
      responses: [{
        hits: {
          total: 1,
          hits: [{
            _id: 'task-1',
            _score: 0.82,
            _source: { title: 'Build feature' },
            _rerank_score: 0.94,
          }],
        },
        took: 12,
      }],
    }))

    const adapter = await createInitializedAdapter()
    const result = await adapter.query('bakin_tasks', {
      text: 'build feature',
      adapterOptions: { rerankField: 'description' },
    })

    expect(result.hits).toHaveLength(1)
    expect(result.hits[0].score).toBe(0.82)
    expect(result.hits[0].scoreBreakdown?.rerank).toBe(0.94)
  })

  it('only sends vector indexes when semantic search is in play', async () => {
    const adapter = await createInitializedAdapter()

    // rrf (default): both search modes + vector indexes
    await adapter.query('bakin_tasks', { text: 'build feature' })
    const hybrid = tableQueryRequest(0) as Record<string, unknown>
    expect(hybrid.full_text_search).toEqual({ query: 'build feature' })
    expect(hybrid.semantic_search).toBe('build feature')
    expect(hybrid.indexes).toEqual(['embeddings'])

    // fts: no semantic_search, no indexes field at all (v0.2: indexes is
    // "required when using semantic_search", meaningless otherwise)
    await adapter.query('bakin_tasks', { text: 'build feature', strategy: 'fts' })
    const fts = tableQueryRequest(1) as Record<string, unknown>
    expect(fts.full_text_search).toEqual({ query: 'build feature' })
    expect(fts.semantic_search).toBeUndefined()
    expect(fts.indexes).toBeUndefined()

    // vector: semantic only, indexes present
    await adapter.query('bakin_tasks', { text: 'build feature', strategy: 'vector' })
    const vector = tableQueryRequest(2) as Record<string, unknown>
    expect(vector.full_text_search).toBeUndefined()
    expect(vector.semantic_search).toBe('build feature')
    expect(vector.indexes).toEqual(['embeddings'])
  })

  it('keeps the default dimension when an embedder override omits it', async () => {
    // A legacy settings.json may override embedders with only provider+model.
    // Dropping `dimension` would 400 every table create (v0.2 requires
    // declared dims), so per-embedder entries deep-merge over defaults.
    const adapter = await createInitializedAdapter({
      embedders: { default: { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5' } },
    })

    await adapter.tables.create('bakin_memory', {
      fields: { body: { type: 'text' } },
      indexes: [{ name: 'embeddings', fields: ['body'], kind: 'vector' }],
    })

    const created = (mockTablesCreate.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0][1]
    const indexes = created.indexes as Record<string, Record<string, unknown>>
    expect(indexes.embeddings.dimension).toBe(384)
  })

  it('builds nested v0.2 chunker config for chunked vector indexes', async () => {
    const adapter = await createInitializedAdapter()

    await adapter.tables.create('bakin_memory', {
      fields: { body: { type: 'text' } },
      indexes: [{
        name: 'embeddings',
        fields: ['body'],
        kind: 'vector',
        chunker: { enabled: true, targetTokens: 300, overlapTokens: 40 },
      }],
    })

    const created = (mockTablesCreate.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0][1]
    const indexes = created.indexes as Record<string, Record<string, unknown>>
    expect(indexes.embeddings.chunker).toEqual({
      provider: 'antfly',
      model: 'fixed',
      text: { target_tokens: 300, overlap_tokens: 40 },
    })
    // v0.1 flat fields must be gone
    expect(indexes.embeddings.chunk_size).toBeUndefined()
    expect(indexes.embeddings.chunk_overlap).toBeUndefined()
    // Dense indexes must declare dims (live server rejects them otherwise),
    // and the server creates its own full-text index — we must not send one.
    expect(indexes.embeddings.dimension).toBe(384)
    expect(indexes.search).toBeUndefined()
    // A create-time schema permanently breaks queries on the table at
    // v0.2.0-rc.2 (bakin#456) — it must never be sent.
    expect(created.schema).toBeUndefined()
  })

  it('maps generic media URL indexes to Antfly media templates', async () => {
    const adapter = await createInitializedAdapter()

    await adapter.tables.create('bakin_assets', {
      fields: {
        image_url: { type: 'keyword' },
      },
      indexes: [{
        name: 'assets_visual',
        fields: ['image_url'],
        kind: 'vector',
        embedderRef: 'visual',
        mediaUrlField: 'image_url',
      }],
    })

    const created = (mockTablesCreate.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0][1]
    const indexes = created.indexes as Record<string, { template?: string }>
    expect(indexes.assets_visual.template).toBe('{{#if image_url}}{{remoteMedia url=image_url}}{{/if}}')
  })

  it('maps index health and returns null when health lookup fails', async () => {
    mockIndexesList.mockResolvedValueOnce({
      embeddings: {
        config: { name: 'embeddings', type: 'embeddings' },
        status: {
          total_indexed: 30,
          wal_backlog: 15,
          rebuilding: true,
          backfill_progress: 0.67,
        },
      },
    })

    const adapter = await createInitializedAdapter()
    const health = await adapter.tables.getHealth('bakin_tasks')
    expect(health?.status).toBe('warn')
    expect((health?.details as { indexes: Array<{ walBacklog: number }> }).indexes[0].walBacklog).toBe(15)

    mockIndexesList.mockRejectedValueOnce(new Error('network timeout'))
    expect(await adapter.tables.getHealth('bakin_tasks')).toBeNull()
  })

  it('retries transient batch errors before succeeding', async () => {
    mockTablesBatch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ inserted: 1, deleted: 0 })

    const adapter = await createInitializedAdapter()
    await adapter.documents.index('bakin_memory', 'audit:abc', { tier: 'audit' })

    expect(mockTablesBatch).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-transient batch errors', async () => {
    mockTablesBatch.mockRejectedValue(new Error('bad request: invalid schema'))

    const adapter = await createInitializedAdapter()
    await adapter.documents.index('bakin_memory', 'x', {})

    expect(mockTablesBatch).toHaveBeenCalledTimes(1)
  })
})
