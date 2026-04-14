import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted so mock variables survive vi.mock hoisting
const {
  mockGetStatus, mockTablesList, mockTablesCreate, mockTablesDrop,
  mockTablesGet, mockTablesQuery, mockTablesBatch, mockTablesScan,
  mockIndexesList, mockIndexesCreate, mockIndexesDrop, mockMultiquery,
  mockClientInstance,
} = vi.hoisted(() => {
  const mockGetStatus = vi.fn()
  const mockTablesList = vi.fn(async () => [])
  const mockTablesCreate = vi.fn()
  const mockTablesDrop = vi.fn()
  const mockTablesGet = vi.fn()
  const mockTablesQuery = vi.fn()
  const mockTablesBatch = vi.fn()
  const mockTablesScan = vi.fn(async function* () {})
  const mockIndexesList = vi.fn(async () => ({}))
  const mockIndexesCreate = vi.fn()
  const mockIndexesDrop = vi.fn()
  const mockMultiquery = vi.fn()
  const mockClientInstance = {
    getStatus: mockGetStatus,
    tables: {
      list: mockTablesList,
      create: mockTablesCreate,
      drop: mockTablesDrop,
      get: mockTablesGet,
      query: mockTablesQuery,
      multiquery: vi.fn(),
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
  return {
    mockGetStatus, mockTablesList, mockTablesCreate, mockTablesDrop,
    mockTablesGet, mockTablesQuery, mockTablesBatch, mockTablesScan,
    mockIndexesList, mockIndexesCreate, mockIndexesDrop, mockMultiquery,
    mockClientInstance,
  }
})

vi.mock('@/core/settings', () => ({
  getSettings: vi.fn(() => ({
    antfly: {
      enabled: false,
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

vi.mock('@antfly/sdk', () => ({
  default: vi.fn().mockImplementation(() => mockClientInstance),
  AntflyClient: vi.fn().mockImplementation(() => mockClientInstance),
  matchAll: vi.fn(() => ({ match_all: {} })),
}))

vi.mock('@/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

/** Install the mock client on the globalThis singleton that antfly.ts uses. */
function installMockClient() {
  const g = globalThis as any
  g.__bakinAntflyClient = mockClientInstance
  g.__bakinAntflyReady = true
}

function resetAntflyGlobals() {
  const g = globalThis as any
  delete g.__bakinAntflyClient
  delete g.__bakinAntflyReady
  delete g.__bakinAntflyEmbedderHash
}

describe('antfly', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAntflyGlobals()
  })

  it('should export core functions', async () => {
    const antfly = await import('@/core/antfly')
    expect(typeof antfly.enabled).toBe('function')
    expect(typeof antfly.initialize).toBe('function')
    expect(typeof antfly.available).toBe('function')
    expect(typeof antfly.indexDocument).toBe('function')
    expect(typeof antfly.removeDocument).toBe('function')
    expect(typeof antfly.transformDocument).toBe('function')
    expect(typeof antfly.batchIndex).toBe('function')
    expect(typeof antfly.batchRemove).toBe('function')
    expect(typeof antfly.queryTable).toBe('function')
    expect(typeof antfly.multiQuery).toBe('function')
    expect(typeof antfly.createTable).toBe('function')
    expect(typeof antfly.listTables).toBe('function')
    expect(typeof antfly.getTableStats).toBe('function')
    expect(typeof antfly.scanTable).toBe('function')
    expect(typeof antfly.rebuildIndexes).toBe('function')
    expect(typeof antfly.hasEmbedderChanged).toBe('function')
    expect(typeof antfly.indexAuditEvent).toBe('function')
  })

  it('should report disabled when settings say so', async () => {
    const antfly = await import('@/core/antfly')
    expect(antfly.enabled()).toBe(false)
    expect(antfly.available()).toBe(false)
  })

  it('queryTable should return empty when disabled', async () => {
    const antfly = await import('@/core/antfly')
    const result = await antfly.queryTable('bakin_tasks', 'test')
    expect(result).toEqual({ results: [], took: 0, total: 0 })
  })

  it('multiQuery should return empty when disabled', async () => {
    const antfly = await import('@/core/antfly')
    const result = await antfly.multiQuery('test', ['bakin_tasks', 'bakin_assets'])
    expect(result).toEqual({ results: [], took: 0, total: 0 })
  })

  it('indexDocument should no-op when disabled', async () => {
    const antfly = await import('@/core/antfly')
    await antfly.indexDocument('bakin_tasks', 'key-1', { title: 'test' })
  })

  it('should define correct bakin_ table names', async () => {
    const antfly = await import('@/core/antfly')
    expect(antfly.TABLES.tasks).toBe('bakin_tasks')
    expect(antfly.TABLES.audit).toBe('bakin_audit')
    expect(antfly.TABLES.assets).toBe('bakin_assets')
    expect(antfly.TABLES.projects).toBe('bakin_projects')
    expect(antfly.TABLES.workflows).toBe('bakin_workflows')
    expect(antfly.TABLES.schedule).toBe('bakin_schedule')
    expect(antfly.TABLES.team).toBe('bakin_team')
  })

  it('should not have legacy beacon_ table names', async () => {
    const antfly = await import('@/core/antfly')
    const tableValues = Object.values(antfly.TABLES)
    expect(tableValues.every(t => t.startsWith('bakin_'))).toBe(true)
    expect(tableValues.some(t => t.startsWith('beacon_'))).toBe(false)
  })

  // ── getIndexHealth ─────────────────────────────────────────────────

  it('should export getIndexHealth as a function', async () => {
    const antfly = await import('@/core/antfly')
    expect(typeof antfly.getIndexHealth).toBe('function')
  })

  it('getIndexHealth returns null when Antfly disabled', async () => {
    // No client installed — simulates disabled state
    const antfly = await import('@/core/antfly')
    const result = await antfly.getIndexHealth('bakin_tasks')
    expect(result).toBeNull()
  })

  it('getIndexHealth returns structured health for clean indexes', async () => {
    installMockClient()
    mockIndexesList.mockResolvedValue({
      search: {
        config: { name: 'search', type: 'full_text' },
        status: { total_indexed: 50, rebuilding: false },
        shard_status: {},
      },
      embeddings: {
        config: { name: 'embeddings', type: 'embeddings' },
        status: { total_indexed: 50, wal_backlog: 0, rebuilding: false, backfill_progress: 1.0 },
        shard_status: {},
      },
    })

    const antfly = await import('@/core/antfly')
    const result = await antfly.getIndexHealth('bakin_tasks')

    expect(result).not.toBeNull()
    expect(result!.healthy).toBe(true)
    expect(result!.indexes).toHaveLength(2)
    expect(result!.indexes[0]).toMatchObject({
      name: 'search',
      type: 'full_text',
      rebuilding: false,
    })
    expect(result!.indexes[1]).toMatchObject({
      name: 'embeddings',
      type: 'embeddings',
      totalIndexed: 50,
      walBacklog: 0,
      rebuilding: false,
    })
  })

  it('getIndexHealth surfaces index errors', async () => {
    installMockClient()
    mockIndexesList.mockResolvedValue({
      embeddings: {
        config: { name: 'embeddings', type: 'embeddings' },
        status: {
          total_indexed: 10,
          wal_backlog: 0,
          rebuilding: false,
          error: 'embedder model not found: BAAI/bge-small-en-v1.5',
        },
        shard_status: {},
      },
    })

    const antfly = await import('@/core/antfly')
    const result = await antfly.getIndexHealth('bakin_tasks')

    expect(result).not.toBeNull()
    expect(result!.healthy).toBe(false)
    expect(result!.indexes[0]!.error).toBe('embedder model not found: BAAI/bge-small-en-v1.5')
  })

  it('getIndexHealth reports WAL backlog', async () => {
    installMockClient()
    mockIndexesList.mockResolvedValue({
      embeddings: {
        config: { name: 'embeddings', type: 'embeddings' },
        status: {
          total_indexed: 30,
          wal_backlog: 15,
          rebuilding: true,
          backfill_progress: 0.67,
        },
        shard_status: {},
      },
    })

    const antfly = await import('@/core/antfly')
    const result = await antfly.getIndexHealth('bakin_tasks')

    expect(result).not.toBeNull()
    expect(result!.healthy).toBe(false)
    expect(result!.indexes[0]).toMatchObject({
      name: 'embeddings',
      totalIndexed: 30,
      walBacklog: 15,
      rebuilding: true,
      backfillProgress: 0.67,
    })
  })

  it('getIndexHealth returns null when indexes.list throws', async () => {
    installMockClient()
    mockIndexesList.mockRejectedValue(new Error('network timeout'))

    const antfly = await import('@/core/antfly')
    const result = await antfly.getIndexHealth('bakin_tasks')

    expect(result).toBeNull()
  })

  it('getIndexHealth returns healthy with empty indexes when none exist', async () => {
    installMockClient()
    mockIndexesList.mockResolvedValue({})

    const antfly = await import('@/core/antfly')
    const result = await antfly.getIndexHealth('bakin_tasks')

    expect(result).not.toBeNull()
    expect(result!.healthy).toBe(true)
    expect(result!.indexes).toHaveLength(0)
  })
})
