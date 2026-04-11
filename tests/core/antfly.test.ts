import { describe, it, expect, vi } from 'vitest'

// Mock settings with antfly disabled
vi.mock('@/core/settings', () => ({
  getSettings: vi.fn(() => ({
    antfly: {
      enabled: false,
      url: 'http://localhost:8080',
      search: { strategy: 'rrf', defaultLimit: 20 },
      embedder: { provider: 'antfly', model: 'all-MiniLM-L6-v2' },
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
  }
})

describe('antfly', () => {
  it('should export expected functions', async () => {
    const antfly = await import('@/core/antfly')
    expect(typeof antfly.enabled).toBe('function')
    expect(typeof antfly.initialize).toBe('function')
    expect(typeof antfly.index).toBe('function')
    expect(typeof antfly.remove).toBe('function')
    expect(typeof antfly.search).toBe('function')
    expect(typeof antfly.syncFile).toBe('function')
    expect(typeof antfly.indexCompletedTask).toBe('function')
    expect(typeof antfly.indexAuditEvent).toBe('function')
  })

  it('should export new SDK-based functions', async () => {
    const antfly = await import('@/core/antfly')
    expect(typeof antfly.indexDocument).toBe('function')
    expect(typeof antfly.removeDocument).toBe('function')
    expect(typeof antfly.transformDocument).toBe('function')
    expect(typeof antfly.batchIndex).toBe('function')
    expect(typeof antfly.batchRemove).toBe('function')
    expect(typeof antfly.queryTable).toBe('function')
    expect(typeof antfly.multiQuery).toBe('function')
    expect(typeof antfly.createTable).toBe('function')
    expect(typeof antfly.getTableStats).toBe('function')
    expect(typeof antfly.scanTable).toBe('function')
    expect(typeof antfly.rebuildIndexes).toBe('function')
    expect(typeof antfly.hasEmbedderChanged).toBe('function')
  })

  it('should report disabled when settings say so', async () => {
    const antfly = await import('@/core/antfly')
    expect(antfly.enabled()).toBe(false)
  })

  it('search should return empty array when disabled', async () => {
    const antfly = await import('@/core/antfly')
    const results = await antfly.search('test query')
    expect(results).toEqual([])
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

  it('index should no-op when disabled', async () => {
    const antfly = await import('@/core/antfly')
    await antfly.index('tasks', { id: 'test', content: 'test content' })
  })

  it('indexDocument should no-op when disabled', async () => {
    const antfly = await import('@/core/antfly')
    await antfly.indexDocument('bakin_tasks', 'key-1', { title: 'test' })
  })

  it('syncFile should no-op when disabled', async () => {
    const antfly = await import('@/core/antfly')
    await antfly.syncFile('projects/test.md', 'some content')
  })

  it('should define correct bakin_ table names', async () => {
    const antfly = await import('@/core/antfly')
    expect(antfly.TABLES.tasks).toBe('bakin_tasks')
    expect(antfly.TABLES.audit).toBe('bakin_audit')
    expect(antfly.TABLES.content).toBe('bakin_content')
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
