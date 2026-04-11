import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared mutable reference so the test can swap the query mock between cases
// and tweak settings without reinstantiating the SDK mock.
const mockQuery = vi.fn(async () => ({
  responses: [{ hits: { hits: [], total: 0 }, took: 0 }],
}))
const mockMultiquery = vi.fn(async () => ({
  responses: [{ hits: { hits: [], total: 0 }, took: 0 }],
}))
const mockGetStatus = vi.fn(async () => ({ health: 'healthy' }))
const mockListTables = vi.fn(async () => [])

// Settings factory — mutated between tests via `settingsState`
const settingsState = {
  rerankerEnabled: true,
  rerankerProvider: 'termite',
  rerankerModel: 'mxbai-rerank-base-v1',
  rerankerThreshold: 0.0 as number | undefined,
}

vi.mock('@/core/settings', () => ({
  getSettings: vi.fn(() => ({
    antfly: {
      enabled: true,
      url: 'http://localhost:8080/api/v1',
      search: {
        strategy: 'rrf',
        defaultLimit: 20,
        reranker: {
          enabled: settingsState.rerankerEnabled,
          provider: settingsState.rerankerProvider,
          model: settingsState.rerankerModel,
          threshold: settingsState.rerankerThreshold,
        },
      },
      embedders: {
        default: { provider: 'antfly', model: 'all-MiniLM-L6-v2' },
        visual: { provider: 'antfly', model: 'clip-vit-base-patch32' },
      },
      chunking: { defaultTargetTokens: 200, defaultOverlapTokens: 25 },
      auditTtl: '90d',
      cleanupInterval: '24h',
      internal: { token: '', port: 3738 },
    },
  })),
}))

vi.mock('@antfly/sdk', () => {
  class MockAntflyClient {
    getStatus = mockGetStatus
    tables = {
      list: mockListTables,
      create: vi.fn(),
      drop: vi.fn(),
      get: vi.fn(),
      query: mockQuery,
      multiquery: vi.fn(),
      batch: vi.fn(),
      scan: vi.fn(async function* () {}),
    }
    indexes = { list: vi.fn(), create: vi.fn(), drop: vi.fn() }
    multiquery = mockMultiquery
  }
  return {
    AntflyClient: MockAntflyClient,
    matchAll: vi.fn(() => ({ match_all: {} })),
  }
})

// Bakin's antfly module uses globalThis to survive Next.js webpack
// re-evaluation. In tests we reset those keys between cases so the next
// initialize() call creates a fresh client pointed at our current mock.
async function resetAndInitAntfly() {
  const g = globalThis as unknown as Record<string, unknown>
  delete g.__bakinAntflyClient
  delete g.__bakinAntflyReady
  const mod = await import('@/core/antfly')
  await mod.initialize()
  return mod
}

describe('antfly reranker wiring', () => {
  beforeEach(() => {
    mockQuery.mockClear()
    mockMultiquery.mockClear()
    settingsState.rerankerEnabled = true
    settingsState.rerankerProvider = 'termite'
    settingsState.rerankerModel = 'mxbai-rerank-base-v1'
    settingsState.rerankerThreshold = 0.0
  })

  it('attaches reranker config when enabled in settings (default)', async () => {
    const antfly = await resetAndInitAntfly()
    await antfly.queryTable('bakin_tasks', 'build feature')

    expect(mockQuery).toHaveBeenCalledTimes(1)
    const request = mockQuery.mock.calls[0][1] as { reranker?: Record<string, unknown> }
    expect(request.reranker).toEqual({
      provider: 'termite',
      model: 'mxbai-rerank-base-v1',
      threshold: 0.0,
    })
  })

  it('omits reranker when rerank: false is passed per-query', async () => {
    const antfly = await resetAndInitAntfly()
    await antfly.queryTable('bakin_tasks', 'build feature', { rerank: false })

    const request = mockQuery.mock.calls[0][1] as { reranker?: Record<string, unknown> }
    expect(request.reranker).toBeUndefined()
  })

  it('omits reranker when globally disabled in settings', async () => {
    settingsState.rerankerEnabled = false
    const antfly = await resetAndInitAntfly()
    await antfly.queryTable('bakin_tasks', 'build feature')

    const request = mockQuery.mock.calls[0][1] as { reranker?: Record<string, unknown> }
    expect(request.reranker).toBeUndefined()
  })

  it('per-query rerank: false still wins when settings enable reranker', async () => {
    settingsState.rerankerEnabled = true
    const antfly = await resetAndInitAntfly()
    await antfly.queryTable('bakin_tasks', 'build feature', { rerank: false })

    const request = mockQuery.mock.calls[0][1] as { reranker?: Record<string, unknown> }
    expect(request.reranker).toBeUndefined()
  })

  it('omits threshold from reranker config when not set', async () => {
    settingsState.rerankerThreshold = undefined
    const antfly = await resetAndInitAntfly()
    await antfly.queryTable('bakin_tasks', 'build feature')

    const request = mockQuery.mock.calls[0][1] as { reranker?: Record<string, unknown> }
    expect(request.reranker).toEqual({
      provider: 'termite',
      model: 'mxbai-rerank-base-v1',
    })
  })

  it('multiQuery attaches reranker to every per-table request', async () => {
    const antfly = await resetAndInitAntfly()
    await antfly.multiQuery('build feature', ['bakin_tasks', 'bakin_assets'])

    expect(mockMultiquery).toHaveBeenCalledTimes(1)
    const requests = mockMultiquery.mock.calls[0][0] as Array<{ reranker?: Record<string, unknown> }>
    expect(requests).toHaveLength(2)
    for (const req of requests) {
      expect(req.reranker).toEqual({
        provider: 'termite',
        model: 'mxbai-rerank-base-v1',
        threshold: 0.0,
      })
    }
  })

  it('mapHits exposes rerankScore when Antfly returns one', async () => {
    mockQuery.mockImplementationOnce(async () => ({
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

    const antfly = await resetAndInitAntfly()
    const result = await antfly.queryTable('bakin_tasks', 'build feature')

    expect(result.results).toHaveLength(1)
    expect(result.results[0].rerankScore).toBe(0.94)
    expect(result.results[0].score).toBe(0.82)
  })
})
