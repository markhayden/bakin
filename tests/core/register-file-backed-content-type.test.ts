import { describe, it, expect, vi, beforeEach } from 'vitest'

const syncHooks: Array<(rel: string, content: string) => void | Promise<void>> = []
const unlinkHooks: Array<(rel: string) => void | Promise<void>> = []

vi.mock('@/core/watcher', () => ({
  registerSyncHook: vi.fn((cb: (rel: string, content: string) => void | Promise<void>) => {
    syncHooks.push(cb)
  }),
  registerUnlinkHook: vi.fn((cb: (rel: string) => void | Promise<void>) => {
    unlinkHooks.push(cb)
  }),
}))

vi.mock('@/core/content-dir', () => ({
  getContentDir: () => '/tmp/bakin-test-helper',
  getBakinPaths: () => ({
    contentDir: '/tmp/bakin-test-helper',
    settingsPath: '/tmp/bakin-test-helper/settings.json',
  }),
}))

vi.mock('@/core/antfly', () => ({
  enabled: vi.fn(() => true),
  createTable: vi.fn(async () => true),
  listTables: vi.fn(async () => []),
  indexDocument: vi.fn(async () => {}),
  removeDocument: vi.fn(async () => {}),
  transformDocument: vi.fn(async () => {}),
  scanTable: vi.fn(async function* () {}),
  rebuildIndexes: vi.fn(async () => {}),
  batchIndex: vi.fn(async (_t: string, docs: Record<string, unknown>) => Object.keys(docs).length),
  multiQuery: vi.fn(async () => ({ results: [], total: 0, took: 0 })),
  queryTable: vi.fn(async () => ({ results: [], total: 0, took: 0 })),
  getIndexHealth: vi.fn(async () => null),
  getTableStats: vi.fn(async () => null),
}))

vi.mock('@/core/settings', () => ({
  getSettings: vi.fn(() => ({
    antfly: {
      enabled: true,
      url: 'http://localhost:8080/api/v1',
      search: {
        strategy: 'rrf',
        defaultLimit: 20,
        reranker: { enabled: false },
      },
      embedders: {
        default: { provider: 'termite', model: 'BAAI/bge-small-en-v1.5' },
      },
      chunking: { defaultTargetTokens: 200, defaultOverlapTokens: 25 },
      auditTtl: '90d',
      cleanupInterval: '7d',
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

vi.mock('@/core/sse', () => ({
  broadcast: vi.fn(),
}))

import { buildSearchAPI, resetSearchRegistry } from '@/core/search-registry'
import * as antfly from '@/core/antfly'
import type { FileBackedContentTypeDefinition } from '../../packages/core/src/plugin-types'

describe('registerFileBackedContentType', () => {
  beforeEach(() => {
    resetSearchRegistry()
    syncHooks.length = 0
    unlinkHooks.length = 0
    vi.clearAllMocks()
  })

  function makeDef(overrides: Partial<FileBackedContentTypeDefinition> = {}): FileBackedContentTypeDefinition {
    return {
      table: 'projects',
      schema: { title: { type: 'text' } },
      searchableFields: ['title'],
      embeddingTemplate: '{{title}}',
      reindex: async function* () {},
      verifyExists: async () => true,
      filePatterns: [
        {
          pattern: 'projects/*.md',
          fileToId: (rel) => rel.replace(/^projects\//, '').replace(/\.md$/, ''),
          fileToDoc: async (rel, content) => ({ title: rel, body: content }),
        },
      ],
      buildOnStartup: false, // skip pending reconcile in unit tests
      ...overrides,
    }
  }

  it('registers the underlying content type and creates the table', () => {
    const api = buildSearchAPI('projects')
    api.registerFileBackedContentType(makeDef())
    // The hook is registered as a side effect
    expect(syncHooks).toHaveLength(1)
    expect(unlinkHooks).toHaveLength(1)
  })

  it('sync hook indexes documents matching the pattern', async () => {
    const api = buildSearchAPI('projects')
    api.registerFileBackedContentType(makeDef())

    await syncHooks[0]('projects/foo.md', 'foo body')

    expect(antfly.indexDocument).toHaveBeenCalledOnce()
    const [tableName, key, doc] = vi.mocked(antfly.indexDocument).mock.calls[0]
    expect(tableName).toBe('bakin_projects')
    expect(key).toBe('foo')
    expect((doc as Record<string, unknown>).title).toBe('projects/foo.md')
  })

  it('sync hook ignores files outside the pattern scope', async () => {
    const api = buildSearchAPI('projects')
    api.registerFileBackedContentType(makeDef())

    await syncHooks[0]('other/foo.md', 'foo')
    await syncHooks[0]('projects/foo.txt', 'foo')

    expect(antfly.indexDocument).not.toHaveBeenCalled()
  })

  it('sync hook honors excludePatterns', async () => {
    const api = buildSearchAPI('projects')
    api.registerFileBackedContentType(makeDef({
      filePatterns: [
        {
          pattern: 'assets/**/*',
          fileToId: (rel) => rel,
          fileToDoc: async (rel) => ({ path: rel }),
        },
      ],
      excludePatterns: ['assets/**/.trash/**'],
      table: 'assets',
    }))

    await syncHooks[0]('assets/image/.trash/old.jpg', '')
    expect(antfly.indexDocument).not.toHaveBeenCalled()

    await syncHooks[0]('assets/image/live.jpg', '')
    expect(antfly.indexDocument).toHaveBeenCalledOnce()
  })

  it('sync hook delegates to onSync escape hatch when provided', async () => {
    const onSync = vi.fn(async () => {})
    const api = buildSearchAPI('assets')
    api.registerFileBackedContentType(makeDef({
      filePatterns: [
        {
          pattern: 'assets/**/*',
          fileToId: (rel) => rel,
          fileToDoc: async (rel) => ({ path: rel }),
        },
      ],
      onSync,
      table: 'assets',
    }))

    await syncHooks[0]('assets/image/foo.jpg', '')

    expect(onSync).toHaveBeenCalledOnce()
    expect(onSync).toHaveBeenCalledWith('assets/image/foo.jpg', '')
    // The standard index path is bypassed
    expect(antfly.indexDocument).not.toHaveBeenCalled()
  })

  it('unlink hook removes documents matching the pattern', async () => {
    const api = buildSearchAPI('projects')
    api.registerFileBackedContentType(makeDef())

    await unlinkHooks[0]('projects/bar.md')

    expect(antfly.removeDocument).toHaveBeenCalledOnce()
    const [tableName, key] = vi.mocked(antfly.removeDocument).mock.calls[0]
    expect(tableName).toBe('bakin_projects')
    expect(key).toBe('bar')
  })

  it('unlink hook ignores files outside the pattern scope', async () => {
    const api = buildSearchAPI('projects')
    api.registerFileBackedContentType(makeDef())

    await unlinkHooks[0]('other/bar.md')
    expect(antfly.removeDocument).not.toHaveBeenCalled()
  })

  it('unlink hook delegates to onUnlink escape hatch when provided', async () => {
    const onUnlink = vi.fn(async () => {})
    const api = buildSearchAPI('assets')
    api.registerFileBackedContentType(makeDef({
      filePatterns: [
        {
          pattern: 'assets/**/*',
          fileToId: (rel) => rel,
          fileToDoc: async (rel) => ({ path: rel }),
        },
      ],
      onUnlink,
      table: 'assets',
    }))

    await unlinkHooks[0]('assets/image/old.jpg')

    expect(onUnlink).toHaveBeenCalledOnce()
    expect(onUnlink).toHaveBeenCalledWith('assets/image/old.jpg')
    expect(antfly.removeDocument).not.toHaveBeenCalled()
  })

  it('skips indexing when mapper.fileToDoc returns null', async () => {
    const api = buildSearchAPI('projects')
    api.registerFileBackedContentType(makeDef({
      filePatterns: [
        {
          pattern: 'projects/*.md',
          fileToId: (rel) => rel,
          fileToDoc: async () => null,
        },
      ],
    }))

    await syncHooks[0]('projects/foo.md', 'x')
    expect(antfly.indexDocument).not.toHaveBeenCalled()
  })

  it('multiple filePatterns route to the correct mapper', async () => {
    const fileToIdA = vi.fn((rel: string) => `def:${rel}`)
    const fileToIdB = vi.fn((rel: string) => `inst:${rel}`)
    const fileToDocA = vi.fn(async () => ({ kind: 'definition' }))
    const fileToDocB = vi.fn(async () => ({ kind: 'instance' }))

    const api = buildSearchAPI('workflows')
    api.registerFileBackedContentType(makeDef({
      table: 'workflows',
      filePatterns: [
        { pattern: 'workflows/definitions/*.{yaml,yml}', fileToId: fileToIdA, fileToDoc: fileToDocA },
        { pattern: 'workflows/instances/*.json', fileToId: fileToIdB, fileToDoc: fileToDocB },
      ],
    }))

    await syncHooks[0]('workflows/definitions/x.yaml', 'name: x')
    await syncHooks[0]('workflows/instances/y.json', '{}')

    expect(fileToDocA).toHaveBeenCalledOnce()
    expect(fileToDocB).toHaveBeenCalledOnce()
    expect(antfly.indexDocument).toHaveBeenCalledTimes(2)
    const calls = vi.mocked(antfly.indexDocument).mock.calls
    const keys = calls.map(c => c[1])
    expect(keys).toContain('def:workflows/definitions/x.yaml')
    expect(keys).toContain('inst:workflows/instances/y.json')
  })

  it('hook errors are caught and logged, not thrown', async () => {
    const api = buildSearchAPI('projects')
    api.registerFileBackedContentType(makeDef({
      filePatterns: [
        {
          pattern: 'projects/*.md',
          fileToId: () => { throw new Error('boom') },
          fileToDoc: async () => ({ title: 'x' }),
        },
      ],
    }))

    await expect(syncHooks[0]('projects/foo.md', 'x')).resolves.not.toThrow()
  })
})
