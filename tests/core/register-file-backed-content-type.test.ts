import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { clearSearchAdapter, createSearchAdapterHarness, installSearchAdapter } from '../helpers/search-adapter'

const syncHooks: Array<(rel: string, content: string) => void | Promise<void>> = []
const unlinkHooks: Array<(rel: string) => void | Promise<void>> = []

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/watcher', () => ({
  registerSyncHook: mock((cb: (rel: string, content: string) => void | Promise<void>) => {
    syncHooks.push(cb)
  }),
  registerUnlinkHook: mock((cb: (rel: string) => void | Promise<void>) => {
    unlinkHooks.push(cb)
  }),
}))

const contentDirFactory = () => ({
  getContentDir: () => '/tmp/bakin-test-helper',
  getBakinPaths: () => ({
    contentDir: '/tmp/bakin-test-helper',
    settingsPath: '/tmp/bakin-test-helper/settings.json',
  }),
})
mock.module('@/core/content-dir', contentDirFactory)
// The search outbox reads packages/core/src/content-dir directly — mock BOTH
// resolvers (CLAUDE.md § Testing Rules), else the real one hits ~/.bakin.
mock.module('../../packages/core/src/content-dir', contentDirFactory)

mock.module('@/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: mock(() => ({
    search: {
      adapter: 'antfly',
      settings: {
        enabled: true,
        url: 'http://localhost:8080/api/v1',
        search: {
          strategy: 'rrf',
          defaultLimit: 20,
          reranker: { enabled: false },
        },
        embedders: {
          default: { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5' },
        },
        chunking: { defaultTargetTokens: 200, defaultOverlapTokens: 25 },
        auditTtl: '90d',
        cleanupInterval: '7d',
      },
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

import { buildSearchAPI, resetSearchRegistry } from '@/core/search-registry'
import type { FileBackedContentTypeDefinition } from '../../packages/core/src/plugin-types'

describe('registerFileBackedContentType', () => {
  let searchHarness: ReturnType<typeof createSearchAdapterHarness>

  beforeEach(() => {
    resetSearchRegistry()
    searchHarness = createSearchAdapterHarness()
    installSearchAdapter(searchHarness.adapter)
    syncHooks.length = 0
    unlinkHooks.length = 0
    mock.clearAllMocks()
  })

  afterEach(() => {
    clearSearchAdapter()
  })

  function makeDef(overrides: Partial<FileBackedContentTypeDefinition> = {}): FileBackedContentTypeDefinition {
    return {
      table: 'projects',
      schemaVersion: 1,
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

    expect(searchHarness.calls.documentsIndex).toHaveBeenCalledTimes(1)
    const [tableName, key, doc] = searchHarness.calls.documentsIndex.mock.calls[0]
    expect(tableName).toBe('bakin_projects')
    expect(key).toBe('foo')
    expect((doc as Record<string, unknown>).title).toBe('projects/foo.md')
  })

  it('routes a primary + file-backed secondary to the right tables (team regression)', async () => {
    // Reproduces the pluginTables 1:1 bug: a plugin (like team) with a direct
    // primary content type registered FIRST and a file-backed secondary SECOND.
    // The old last-write-wins resolver sent the primary's direct index() calls
    // into the secondary's table.
    const api = buildSearchAPI('team-like')
    api.registerContentType({
      table: 'agents',
      schemaVersion: 1,
      schema: { name: { type: 'text' } },
      searchableFields: ['name'],
      embeddingTemplate: '{{name}}',
      reindex: async function* () {},
      verifyExists: async () => true,
    })
    api.registerFileBackedContentType(makeDef({ table: 'agent-lessons' }))

    // Direct index() resolves to the PRIMARY table, not the last-registered one.
    await api.index('a1', { name: 'Agent One' })
    expect(searchHarness.calls.documentsIndex).toHaveBeenCalledWith(
      'bakin_agents',
      'a1',
      expect.objectContaining({ name: 'Agent One' }),
    )

    // The file-backed sync hook indexes into ITS OWN table (the secondary).
    searchHarness.calls.documentsIndex.mockClear()
    await syncHooks[syncHooks.length - 1]('projects/foo.md', 'foo body')
    expect(searchHarness.calls.documentsIndex.mock.calls[0][0]).toBe('bakin_agent-lessons')
  })

  it('sync hook ignores files outside the pattern scope', async () => {
    const api = buildSearchAPI('projects')
    api.registerFileBackedContentType(makeDef())

    await syncHooks[0]('other/foo.md', 'foo')
    await syncHooks[0]('projects/foo.txt', 'foo')

    expect(searchHarness.calls.documentsIndex).not.toHaveBeenCalled()
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
    expect(searchHarness.calls.documentsIndex).not.toHaveBeenCalled()

    await syncHooks[0]('assets/image/live.jpg', '')
    expect(searchHarness.calls.documentsIndex).toHaveBeenCalledTimes(1)
  })

  it('sync hook delegates to onSync escape hatch when provided', async () => {
    const onSync = mock(async () => {})
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

    expect(onSync).toHaveBeenCalledTimes(1)
    expect(onSync).toHaveBeenCalledWith('assets/image/foo.jpg', '')
    // The standard index path is bypassed
    expect(searchHarness.calls.documentsIndex).not.toHaveBeenCalled()
  })

  it('unlink hook removes documents matching the pattern', async () => {
    const api = buildSearchAPI('projects')
    api.registerFileBackedContentType(makeDef())

    await unlinkHooks[0]('projects/bar.md')

    expect(searchHarness.calls.documentsRemove).toHaveBeenCalledTimes(1)
    const [tableName, key] = searchHarness.calls.documentsRemove.mock.calls[0]
    expect(tableName).toBe('bakin_projects')
    expect(key).toBe('bar')
  })

  it('unlink hook ignores files outside the pattern scope', async () => {
    const api = buildSearchAPI('projects')
    api.registerFileBackedContentType(makeDef())

    await unlinkHooks[0]('other/bar.md')
    expect(searchHarness.calls.documentsRemove).not.toHaveBeenCalled()
  })

  it('unlink hook delegates to onUnlink escape hatch when provided', async () => {
    const onUnlink = mock(async () => {})
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

    expect(onUnlink).toHaveBeenCalledTimes(1)
    expect(onUnlink).toHaveBeenCalledWith('assets/image/old.jpg')
    expect(searchHarness.calls.documentsRemove).not.toHaveBeenCalled()
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
    expect(searchHarness.calls.documentsIndex).not.toHaveBeenCalled()
  })

  it('multiple filePatterns route to the correct mapper', async () => {
    const fileToIdA = mock((rel: string) => `def:${rel}`)
    const fileToIdB = mock((rel: string) => `inst:${rel}`)
    const fileToDocA = mock(async () => ({ kind: 'definition' }))
    const fileToDocB = mock(async () => ({ kind: 'instance' }))

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

    expect(fileToDocA).toHaveBeenCalledTimes(1)
    expect(fileToDocB).toHaveBeenCalledTimes(1)
    expect(searchHarness.calls.documentsIndex).toHaveBeenCalledTimes(2)
    const calls = searchHarness.calls.documentsIndex.mock.calls
    const keys = calls.map((c) => c[1])
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

    // bun:test doesn't compose `resolves.not.toThrow` — await directly
    await syncHooks[0]('projects/foo.md', 'x')
  })
})
