/**
 * MCP search tools plugin-param coverage.
 *
 * Phase-1 commit 64b49be rewrote scripts/lib/search-tools.ts so every tool
 * accepts `plugin: <pluginId>` instead of a raw table name. These tests
 * exercise the resolution path for all 7 tools through the in-memory
 * exec-tool registry.
 *
 * We mock src/core/search-registry so tools execute
 * end-to-end without an Antfly backend.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const TEST_DIR = join(tmpdir(), `bakin-test-mcp-search-${process.pid}-${Date.now()}`)

// ---------------------------------------------------------------------------
// Mandatory test isolation mocks
// ---------------------------------------------------------------------------

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => TEST_DIR,
  getBakinPaths: () => ({
    home: TEST_DIR,
    assets: join(TEST_DIR, 'assets'),
    audit: join(TEST_DIR, 'audit.jsonl'),
    heartbeats: join(TEST_DIR, 'heartbeats'),
    inbox: join(TEST_DIR, 'inbox'),
    pluginSettings: join(TEST_DIR, 'plugin-settings'),
    schedule: join(TEST_DIR, 'schedule'),
    workflows: join(TEST_DIR, 'workflows'),
    projects: join(TEST_DIR, 'projects'),
    team: join(TEST_DIR, 'team'),
    messaging: join(TEST_DIR, 'messaging'),
    docs: join(TEST_DIR, 'docs'),
    settings: join(TEST_DIR, 'settings.json'),
    memory: join(TEST_DIR, 'MEMORY-LOG.md'),
    plugins: join(TEST_DIR, 'plugins'),
    logs: join(TEST_DIR, 'logs'),
  }),
  isUsingBakinHome: () => false,
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../src/core/watcher', () => ({
  registerSyncHook: mock(() => () => {}),
  registerUnlinkHook: mock(() => () => {}),
  watch: mock(),
  watchFiles: mock(),
  registerWatchPattern: mock(),
  start: mock(),
  stop: mock(),
}))

// ---------------------------------------------------------------------------
// search-registry mock — controls plugin → table resolution and query results
// ---------------------------------------------------------------------------

const KNOWN_PLUGINS: Record<string, string> = {
  tasks: 'bakin_tasks',
  assets: 'bakin_assets',
  projects: 'bakin_projects',
}

const crossTableSearchMock = mock(async (q: string, opts?: { table?: string; limit?: number; facets?: string[] }) => {
  if (opts?.table) {
    return {
      results: [
        { id: 'doc-1', title: `match for ${q}`, _table: opts.table, _score: 0.9 },
      ],
      aggregations: opts.facets?.length
        ? Object.fromEntries(opts.facets.map(f => [f, [{ value: 'todo', count: 3 }]]))
        : undefined,
      meta: { query: q, total: 1, took_ms: 5, source: 'antfly' as const },
    }
  }
  // Cross-plugin
  return {
    results: [
      { id: 'doc-1', title: `match for ${q}`, _table: 'bakin_tasks', _score: 0.9 },
      { id: 'doc-2', title: `also for ${q}`, _table: 'bakin_assets', _score: 0.7 },
    ],
    meta: { query: q, total: 2, took_ms: 12, source: 'antfly' as const },
  }
})

const reindexContentTypesMock = mock(async (opts?: { table?: string }) => {
  if (opts?.table) {
    return [{ table: opts.table, indexed: 5, error: null }]
  }
  return [
    { table: 'bakin_tasks', indexed: 5, error: null },
    { table: 'bakin_assets', indexed: 3, error: null },
  ]
})

const getSearchHealthMock = mock(async () => ({
  enabled: true,
  tables: [
    { table: 'bakin_tasks', pluginId: 'tasks', stats: { docs: 5 }, healthy: true },
    { table: 'bakin_assets', pluginId: 'assets', stats: { docs: 3 }, healthy: true },
  ],
}))

const getContentTypesMock = mock(() => {
  const map = new Map<string, { pluginId: string; facets: string[]; searchableFields: string[]; chunker?: { enabled: boolean } }>()
  map.set('bakin_tasks', { pluginId: 'tasks', facets: ['status'], searchableFields: ['title'] })
  map.set('bakin_assets', { pluginId: 'assets', facets: ['type'], searchableFields: ['title'] })
  map.set('bakin_projects', { pluginId: 'projects', facets: [], searchableFields: ['name'] })
  return map
})

const getTableForPluginMock = mock((pluginId: string): string | null => {
  return KNOWN_PLUGINS[pluginId] ?? null
})

const searchStatsMock = mock(async (table: string) => ({ name: table, docs: 1 }))
const searchQueryMock = mock(async (_table: string, query: { text: string }) => ({
  hits: [
    {
      key: query.text,
      id: query.text,
      title: 'hello',
      body: 'world',
    },
  ],
  total: 1,
}))

mock.module('../../src/core/search-registry', () => ({
  crossTableSearch: crossTableSearchMock,
  reindexContentTypes: reindexContentTypesMock,
  getSearchHealth: getSearchHealthMock,
  getContentTypes: getContentTypesMock,
  getTableForPlugin: getTableForPluginMock,
  getIndexNames: mock(() => ['embeddings']),
  getSearchAdapter: mock(() => ({
    tables: { stats: searchStatsMock },
    query: searchQueryMock,
  })),
  buildSearchAPI: mock(() => ({})),
}))

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(() => {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
})

afterAll(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }) } catch { /* ignore */ }
})

async function getTool(name: string) {
  // Importing search-tools triggers self-registration via addExecTool.
  await import('../../scripts/lib/search-tools')
  const { getExecTool } = require('../../scripts/lib/registry') as typeof import('../../scripts/lib/registry')
  const tool = getExecTool(name)
  if (!tool) throw new Error(`Tool ${name} not registered`)
  return tool
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP search tools — plugin param coverage', () => {
  describe('bakin_exec_search_query', () => {
    it('resolves plugin id to table and runs single-table query', async () => {
      const tool = await getTool('bakin_exec_search_query')
      const result = await tool.handler({ plugin: 'tasks', q: 'foo' }, {} as never)
      expect(result.ok).toBe(true)
      expect(getTableForPluginMock).toHaveBeenCalledWith('tasks')
      const lastCall = crossTableSearchMock.mock.calls.at(-1)!
      expect(lastCall[0]).toBe('foo')
      expect(lastCall[1]?.table).toBe('bakin_tasks')
      // single-table mock returns 1 result
      expect((result as unknown as { results: unknown[] }).results.length).toBe(1)
    })

    it('runs cross-plugin multi-query when plugin omitted', async () => {
      const tool = await getTool('bakin_exec_search_query')
      crossTableSearchMock.mockClear()
      const result = await tool.handler({ q: 'foo' }, {} as never)
      expect(result.ok).toBe(true)
      const lastCall = crossTableSearchMock.mock.calls.at(-1)!
      expect(lastCall[1]?.table).toBeUndefined()
      expect((result as unknown as { results: unknown[] }).results.length).toBe(2)
    })

    it('returns clear error for unknown plugin', async () => {
      const tool = await getTool('bakin_exec_search_query')
      const result = await tool.handler({ plugin: 'nonexistent', q: 'foo' }, {} as never)
      expect(result.ok).toBe(false)
      expect((result as unknown as { error: string }).error).toMatch(/nonexistent/)
      expect((result as unknown as { error: string }).error).toMatch(/no registered search content type/)
    })
  })

  describe('bakin_exec_search_table', () => {
    it('runs single-plugin search with facet aggregation', async () => {
      const tool = await getTool('bakin_exec_search_table')
      const result = await tool.handler({ plugin: 'tasks', q: 'bar', facets: 'status,agent' }, {} as never)
      expect(result.ok).toBe(true)
      const lastCall = crossTableSearchMock.mock.calls.at(-1)!
      expect(lastCall[1]?.table).toBe('bakin_tasks')
      expect(lastCall[1]?.facets).toEqual(['status', 'agent'])
      expect((result as unknown as { aggregations?: Record<string, unknown> }).aggregations).toBeDefined()
    })
  })

  describe('bakin_exec_search_lookup', () => {
    it('looks up document by key for the resolved plugin', async () => {
      const tool = await getTool('bakin_exec_search_lookup')
      const result = await tool.handler({ plugin: 'projects', key: 'doc-1' }, {} as never)
      expect(result.ok).toBe(true)
      expect(searchStatsMock).toHaveBeenCalledWith('bakin_projects')
      expect(searchQueryMock).toHaveBeenCalled()
      expect((result as unknown as { document: { id: string } }).document.id).toBe('doc-1')
    })
  })

  describe('bakin_exec_search_facets', () => {
    it('aggregates facets for the resolved plugin', async () => {
      const tool = await getTool('bakin_exec_search_facets')
      const result = await tool.handler({ plugin: 'tasks', facets: 'status,agent' }, {} as never)
      expect(result.ok).toBe(true)
      const lastCall = crossTableSearchMock.mock.calls.at(-1)!
      expect(lastCall[0]).toBe('*')
      expect(lastCall[1]?.table).toBe('bakin_tasks')
      expect(lastCall[1]?.facets).toEqual(['status', 'agent'])
      expect((result as unknown as { aggregations: Record<string, unknown> }).aggregations).toBeDefined()
    })
  })

  describe('bakin_exec_search_similar', () => {
    it('runs similarity search scoped to a plugin', async () => {
      const tool = await getTool('bakin_exec_search_similar')
      const result = await tool.handler({ plugin: 'assets', text: 'sunset photo', limit: 5 }, {} as never)
      expect(result.ok).toBe(true)
      const lastCall = crossTableSearchMock.mock.calls.at(-1)!
      expect(lastCall[0]).toBe('sunset photo')
      expect(lastCall[1]?.table).toBe('bakin_assets')
      expect(lastCall[1]?.limit).toBe(5)
      expect((result as unknown as { similar: unknown[] }).similar).toBeDefined()
    })
  })

  describe('bakin_exec_search_reindex', () => {
    it('reindexes a single plugin via plugin param', async () => {
      const tool = await getTool('bakin_exec_search_reindex')
      const result = await tool.handler({ plugin: 'tasks' }, {} as never)
      expect(result.ok).toBe(true)
      const lastCall = reindexContentTypesMock.mock.calls.at(-1)!
      expect(lastCall[0]?.table).toBe('bakin_tasks')
      expect((result as unknown as { total: number }).total).toBe(5)
    })
  })

  describe('bakin_exec_search_stats', () => {
    it('returns search system health and registered content types', async () => {
      const tool = await getTool('bakin_exec_search_stats')
      const result = await tool.handler({}, {} as never)
      expect(result.ok).toBe(true)
      expect((result as unknown as { enabled: boolean }).enabled).toBe(true)
      expect((result as unknown as { tables: unknown[] }).tables.length).toBe(2)
      const registered = (result as unknown as { registered: Array<{ pluginId: string }> }).registered
      expect(registered.length).toBe(3)
      expect(registered.map(r => r.pluginId).sort()).toEqual(['assets', 'projects', 'tasks'])
    })
  })
})
