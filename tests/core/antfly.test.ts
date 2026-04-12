import { describe, it, expect, vi } from 'vitest'

// Mock settings with antfly disabled
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

// Mock @antfly/sdk — prevent real HTTP calls
vi.mock('@antfly/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      getStatus: vi.fn(),
      tables: {
        list: vi.fn(async () => []),
        create: vi.fn(),
        drop: vi.fn(),
        get: vi.fn(),
        query: vi.fn(),
        multiquery: vi.fn(),
        batch: vi.fn(),
        scan: vi.fn(async function* () {}),
      },
      indexes: {
        list: vi.fn(async () => ({})),
        create: vi.fn(),
        drop: vi.fn(),
      },
      multiquery: vi.fn(),
    })),
    AntflyClient: vi.fn().mockImplementation(() => ({
      getStatus: vi.fn(),
      tables: {
        list: vi.fn(async () => []),
        create: vi.fn(),
        drop: vi.fn(),
        get: vi.fn(),
        query: vi.fn(),
        multiquery: vi.fn(),
        batch: vi.fn(),
        scan: vi.fn(async function* () {}),
      },
      indexes: {
        list: vi.fn(async () => ({})),
        create: vi.fn(),
        drop: vi.fn(),
      },
      multiquery: vi.fn(),
    })),
    matchAll: vi.fn(() => ({ match_all: {} })),
  }
})

describe('antfly', () => {
  it('should export core functions', async () => {
    const antfly = await import('@/core/antfly')
    expect(typeof antfly.enabled).toBe('function')
    expect(typeof antfly.initialize).toBe('function')
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
})
