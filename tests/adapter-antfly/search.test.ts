import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import type { SearchAdapter } from '@bakin/core/adapters/search'

const testDir = join(tmpdir(), `bakin-test-adapter-antfly-${Date.now()}`)

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
const mockMultiquery = mock(async (requests: unknown[]): Promise<QueryResponse> => ({
  responses: requests.map(() => ({ hits: { hits: [], total: 0 }, took: 0 })),
}))

const mockClientInstance = {
  getStatus: mockGetStatus,
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
  multiquery: mockMultiquery,
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
  url: 'http://localhost:8080/api/v1',
  search: {
    strategy: 'rrf',
    defaultLimit: 20,
    reranker: {
      enabled: true,
      provider: 'termite',
      model: 'mixedbread-ai/mxbai-rerank-base-v1',
      threshold: 0.0,
    },
  },
  embedders: {
    default: { provider: 'termite', model: 'BAAI/bge-small-en-v1.5' },
    visual: { provider: 'antfly', model: 'clip-vit-base-patch32' },
  },
  chunking: { defaultTargetTokens: 200, defaultOverlapTokens: 25 },
}

const realFetch = globalThis.fetch
let adapters: SearchAdapter[] = []

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

function multiQueryRequests(index = 0): Array<Record<string, unknown>> {
  return (mockMultiquery.mock.calls as unknown as Array<[Array<Record<string, unknown>>]>)[index][0]
}

describe('AntflySearchAdapter', () => {
  beforeEach(() => {
    adapters = []
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
    mockMultiquery.mockClear()
    mockMultiquery.mockImplementation(async (requests: unknown[]) => ({
      responses: requests.map(() => ({ hits: { hits: [], total: 0 }, took: 0 })),
    }))
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
  })

  it('attaches reranker config when enabled and rerankField is supplied', async () => {
    const adapter = await createInitializedAdapter()

    await adapter.query('bakin_tasks', {
      text: 'build feature',
      adapterOptions: { rerankField: 'description' },
    })

    const request = tableQueryRequest() as { reranker?: Record<string, unknown> }
    expect(request.reranker).toEqual({
      provider: 'termite',
      model: 'mixedbread-ai/mxbai-rerank-base-v1',
      field: 'description',
      threshold: 0.0,
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

  it('omits threshold from reranker config when unset', async () => {
    const adapter = await createInitializedAdapter({ search: { reranker: { threshold: undefined } } })
    await adapter.query('bakin_tasks', {
      text: 'build feature',
      adapterOptions: { rerankField: 'description' },
    })

    const request = tableQueryRequest() as { reranker?: Record<string, unknown> }
    expect(request.reranker).toEqual({
      provider: 'termite',
      model: 'mixedbread-ai/mxbai-rerank-base-v1',
      field: 'description',
    })
  })

  it('multiQuery attaches reranker per query from adapterOptions', async () => {
    const adapter = await createInitializedAdapter()
    await adapter.multiQuery([
      { table: 'bakin_tasks', query: { text: 'build', adapterOptions: { rerankField: 'description' } } },
      { table: 'bakin_assets', query: { text: 'build' } },
    ])

    const requests = multiQueryRequests() as Array<{ table: string; reranker?: Record<string, unknown> }>
    expect(requests.find(r => r.table === 'bakin_tasks')?.reranker).toEqual({
      provider: 'termite',
      model: 'mixedbread-ai/mxbai-rerank-base-v1',
      field: 'description',
      threshold: 0.0,
    })
    expect(requests.find(r => r.table === 'bakin_assets')?.reranker).toBeUndefined()
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
