import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, writeFileSync } from 'fs'
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
    // v0.2-SDK marker: the adapter's stale-dependency guard requires it.
    scanAll: mock(async () => []),
  },
  indexes: {
    list: mockIndexesList,
    create: mockIndexesCreate,
    drop: mockIndexesDrop,
  },
}

// Boot-time embedder warmup goes through the SDK's InferenceClient.
const mockInferenceEmbed = mock(async (): Promise<{ embeddings: number[][] }> => ({ embeddings: [[0.1]] }))

mock.module('@antfly/sdk', () => ({
  AntflyClient: mock().mockImplementation(() => mockClientInstance),
  InferenceClient: mock().mockImplementation(() => ({ embed: mockInferenceEmbed })),
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

/** Let fire-and-forget warmup promises settle. */
function sleepTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10))
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
    mockInferenceEmbed.mockClear()
    mockInferenceEmbed.mockImplementation(async () => ({ embeddings: [[0.1]] }))
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

  it('multiQuery times out a hung table and still returns the rest', async () => {
    // A wedged backend on one table must not stall the sequential fan-out:
    // the timed-out table gets an empty result + warn, later tables proceed.
    const previousTimeout = process.env.BAKIN_ANTFLY_QUERY_TIMEOUT_MS
    process.env.BAKIN_ANTFLY_QUERY_TIMEOUT_MS = '30'
    try {
      mockGlobalQuery
        .mockImplementationOnce(() => new Promise(() => {})) // hangs forever
        .mockResolvedValueOnce({ hits: { hits: [{ _id: 'a1', _score: 1, _source: {} }], total: 1 }, took: 2 })

      const adapter = await createInitializedAdapter()
      const results = await adapter.multiQuery([
        { table: 'bakin_assets', query: { text: 'x' } },
        { table: 'bakin_tasks', query: { text: 'x' } },
      ])

      expect(results[0].total).toBe(0) // hung table -> empty result
      expect(results[1].total).toBe(1) // later table still answered
      expect(logger.warn).toHaveBeenCalledWith(
        'Antfly query timed out - returning empty result',
        expect.objectContaining({ table: 'bakin_assets', timeoutMs: 30 }),
      )
      expect(logger.error).not.toHaveBeenCalled()
    } finally {
      if (previousTimeout === undefined) delete process.env.BAKIN_ANTFLY_QUERY_TIMEOUT_MS
      else process.env.BAKIN_ANTFLY_QUERY_TIMEOUT_MS = previousTimeout
    }
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

  it('availability health stays amber while search models are missing', async () => {
    // Connected-but-modelless: indexing works while every semantic query
    // dies at query-time embedding. The check must say so, not report ok.
    const previousAntflyHome = process.env.ANTFLY_HOME
    const antflyHome = join(testDir, `health-models-${Date.now()}`)
    process.env.ANTFLY_HOME = antflyHome
    try {
      const adapter = await createInitializedAdapter()
      const [missing] = await adapter.getHealthChecks()[0].run()
      expect(missing.status).toBe('warn')
      expect(missing.message).toContain('search models are missing')
      expect(missing.message).toContain('bakin install search-models')

      // Seed all required models -> ok.
      const { REQUIRED_MODELS } = await import('../../packages/adapter-antfly/src/models')
      for (const m of REQUIRED_MODELS) {
        const dir = join(antflyHome, 'inference', 'models', m.model)
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'model_manifest.json'), '{"type":"embedder"}')
        writeFileSync(join(dir, 'model.onnx'), 'weights')
      }
      const [ok] = await adapter.getHealthChecks()[0].run()
      expect(ok.status).toBe('ok')
    } finally {
      if (previousAntflyHome === undefined) delete process.env.ANTFLY_HOME
      else process.env.ANTFLY_HOME = previousAntflyHome
    }
  })

  it('refuses to run on a pre-0.2 @antfly/sdk (stale node_modules guard)', async () => {
    // Field-verified failure mode: a checkout that skipped `bun install`
    // still loads the old npm SDK, whose calls 404 into "Failed to parse
    // JSON" against a healthy server. The guard names the actual fix.
    const scanAll = (mockClientInstance.tables as Record<string, unknown>).scanAll
    delete (mockClientInstance.tables as Record<string, unknown>).scanAll
    try {
      const adapter = await createInitializedAdapter()
      expect(await adapter.available()).toBe(false)
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Run `bun install`'),
      )
    } finally {
      ;(mockClientInstance.tables as Record<string, unknown>).scanAll = scanAll
    }
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

  it('forwards optional api_url/multimodal embedder fields verbatim', async () => {
    // Documented antfly EmbedderConfig pass-throughs: api_url routes the
    // embedder over HTTP to a named inference endpoint, multimodal declares
    // non-text support for models outside the built-in registry. Unset
    // entries must omit the keys entirely.
    const adapter = await createInitializedAdapter({
      embedders: {
        default: { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5', dimension: 384 },
        visual: {
          provider: 'antfly',
          model: 'antflydb/clipclap',
          dimension: 512,
          api_url: 'http://127.0.0.1:3738',
          multimodal: true,
        },
      },
    })

    await adapter.tables.create('bakin_assets', {
      fields: { content: { type: 'text' }, image_url: { type: 'keyword' } },
      indexes: [
        { name: 'assets_text', fields: ['content'], kind: 'vector' },
        { name: 'assets_visual', fields: ['image_url'], kind: 'vector', embedderRef: 'visual', mediaUrlField: 'image_url' },
      ],
    })

    const created = (mockTablesCreate.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0][1]
    const indexes = created.indexes as Record<string, { embedder: Record<string, unknown> }>
    expect(indexes.assets_visual.embedder).toEqual({
      provider: 'antfly',
      model: 'antflydb/clipclap',
      api_url: 'http://127.0.0.1:3738',
      multimodal: true,
    })
    // Default embedder carries no pass-through keys.
    expect(indexes.assets_text.embedder).toEqual({
      provider: 'antfly',
      model: 'BAAI/bge-small-en-v1.5',
    })
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

  it('query (single-table) times out instead of hanging', async () => {
    // The per-plugin /search routes use query() directly; a table with an
    // active embeddings backfill hangs queries indefinitely at this pin
    // (bakin#456 finding 10) — the ceiling applies here too.
    const previousTimeout = process.env.BAKIN_ANTFLY_QUERY_TIMEOUT_MS
    process.env.BAKIN_ANTFLY_QUERY_TIMEOUT_MS = '30'
    try {
      mockTablesQuery.mockImplementationOnce(() => new Promise(() => {})) // hangs forever
      const adapter = await createInitializedAdapter()
      const result = await adapter.query('bakin_memory', { text: 'x' })
      expect(result.total).toBe(0)
      expect(logger.warn).toHaveBeenCalledWith(
        'Antfly query timed out - returning empty result',
        expect.objectContaining({ table: 'bakin_memory', timeoutMs: 30 }),
      )
    } finally {
      if (previousTimeout === undefined) delete process.env.BAKIN_ANTFLY_QUERY_TIMEOUT_MS
      else process.env.BAKIN_ANTFLY_QUERY_TIMEOUT_MS = previousTimeout
    }
  })

  it('stats counts documents from index status, never via a query', async () => {
    // Queries against a backfilling table hang indefinitely (bakin#456
    // finding 10); doc counts must come from the indexes GET, which doesn't.
    mockIndexesList.mockResolvedValueOnce([
      { config: { name: 'full_text_index_v0', type: 'full_text' }, status: { doc_count: 7893, total_indexed: 7893 } },
      { config: { name: 'embeddings', type: 'embeddings' }, status: { doc_count: 679, total_indexed: 679 } },
    ])

    const adapter = await createInitializedAdapter()
    const stats = await adapter.tables.stats('bakin_memory')

    expect(stats).toEqual({ table: 'bakin_memory', documents: 7893 })
    expect(mockTablesQuery).not.toHaveBeenCalled()
  })

  it('resolves real index names from the v0.2 array shape', async () => {
    // v0.2's indexes.list returns an ARRAY — Object.entries over it produced
    // names "0"/"1" in health payloads and made rebuildIndexes drop
    // nonexistent indexes. Names come from config.name.
    mockIndexesList.mockResolvedValue([
      { config: { name: 'full_text_index_v0', type: 'full_text' }, status: { doc_count: 25 } },
      { config: { name: 'assets_visual', type: 'embeddings' }, status: { total_indexed: 0, wal_backlog: 2, backfill_state: 'failed' } },
    ])

    const adapter = await createInitializedAdapter()
    const health = await adapter.tables.getHealth('bakin_assets')
    const names = (health?.details as { indexes: Array<{ name: string }> }).indexes.map((i) => i.name)
    expect(names).toEqual(['full_text_index_v0', 'assets_visual'])
    // backfill_state 'failed' must surface as unhealthy + named error, not green
    const detail = health?.details as { indexes: Array<{ error?: string }>; healthy: boolean }
    expect(health?.status).toBe('warn')
    expect(detail.indexes[1].error).toContain('backfill failed')

    await adapter.tables.rebuildIndexes('bakin_assets')
    const dropped = (mockIndexesDrop.mock.calls as unknown as Array<[string, string]>).map((c) => c[1])
    expect(dropped).toEqual(['full_text_index_v0', 'assets_visual'])
    mockIndexesList.mockClear()
    mockIndexesList.mockImplementation(async () => ({}))
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

  it('warms each configured local embedder model once at boot', async () => {
    // Cold ONNX model loads are paid at startup, not in a user's first
    // semantic query. One throwaway embed per unique antfly-provider model;
    // duplicate refs to the same model and remote providers are skipped.
    await createInitializedAdapter({
      embedders: {
        default: { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5', dimension: 384 },
        visual: { provider: 'antfly', model: 'Xenova/clip-vit-base-patch32', dimension: 512 },
        alias: { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5', dimension: 384 },
        remote: { provider: 'openai', model: 'text-embedding-3-small', dimension: 1536 },
      },
    })
    await sleepTick()

    const warmed = (mockInferenceEmbed.mock.calls as unknown as Array<[string, string]>).map((c) => c[0])
    expect(warmed.sort()).toEqual(['BAAI/bge-small-en-v1.5', 'Xenova/clip-vit-base-patch32'])
  })

  it('logs warmup failures at debug, never error', async () => {
    // CLIP text-embed fails at the current pin (bakin#456 — InputArityMismatch);
    // warmup must absorb that quietly.
    mockInferenceEmbed.mockRejectedValue(new Error('INFERENCE_FAILED: InputArityMismatch'))

    await createInitializedAdapter()
    await sleepTick()

    expect(mockInferenceEmbed).toHaveBeenCalled()
    expect(logger.debug).toHaveBeenCalledWith(
      'Embedder warmup failed',
      expect.objectContaining({ error: expect.stringContaining('InputArityMismatch') }),
    )
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('skips warmup entirely when the adapter never connects', async () => {
    const adapter = await createInitializedAdapter({ enabled: false })
    await sleepTick()
    expect(await adapter.available()).toBe(false)
    expect(mockInferenceEmbed).not.toHaveBeenCalled()
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
