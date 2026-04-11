import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock antfly module
vi.mock('@/core/antfly', () => ({
  enabled: vi.fn(() => true),
  createTable: vi.fn(async () => true),
  indexDocument: vi.fn(async () => {}),
  removeDocument: vi.fn(async () => {}),
  transformDocument: vi.fn(async () => {}),
  queryTable: vi.fn(async () => ({
    results: [
      { id: 'doc-1', table: 'bakin_tasks', score: 0.95, fields: { title: 'Test task' } },
    ],
    aggregations: {
      status: { buckets: [{ key: 'active', doc_count: 5 }] },
    },
    took: 12,
    total: 1,
  })),
}))

vi.mock('@/core/settings', () => ({
  getSettings: vi.fn(() => ({
    antfly: {
      enabled: true,
      url: 'http://localhost:8080',
      search: { strategy: 'rrf', defaultLimit: 20 },
      embedder: { provider: 'antfly', model: 'all-MiniLM-L6-v2' },
      chunking: { defaultTargetTokens: 200, defaultOverlapTokens: 25 },
      auditTtl: '90d',
      cleanupInterval: '24h',
    },
  })),
}))

vi.mock('@/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import {
  buildSearchAPI,
  getContentTypes,
  getPluginTable,
  createRegisteredTables,
  resetSearchRegistry,
} from '@/core/search-registry'
import * as antfly from '@/core/antfly'

describe('search-registry', () => {
  beforeEach(() => {
    resetSearchRegistry()
    vi.clearAllMocks()
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
    expect(getPluginTable('tasks')).toBe('bakin_tasks')
  })

  it('registerContentType preserves pluginId', () => {
    const api = buildSearchAPI('my-plugin')
    api.registerContentType(makeDef('widgets'))

    const entry = getContentTypes().get('bakin_widgets')
    expect(entry?.pluginId).toBe('my-plugin')
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
      }),
    )
    expect(result.meta.source).toBe('antfly')
    expect(result.results).toHaveLength(1)
    expect(result.aggregations?.status).toEqual([{ value: 'active', count: 5 }])
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
})
