/**
 * Memory-plugin-owned doctor check.
 *
 * Migrated out of src/core/doctor.ts (#139 C5). Behavioral coverage
 * for checkSearchTables — search-disabled / search-unavailable /
 * empty registry / per-table doc-count branches / aggregate ok and
 * warn paths.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-memory-health-${Date.now()}-${randomUUID()}`)

process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import type { SearchHealthSnapshot } from '../../../packages/core/src/plugin-types'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../packages/core/src/openclaw-home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

let mockSearchEnabled = true
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({
    search: { adapter: 'antfly', settings: { enabled: mockSearchEnabled } },
    doctor: { autoFixSkill: false },
  }),
  resetSettingsCache: () => {},
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

interface MockTable {
  table: string
  pluginId: string
  healthy: boolean
  stats: Record<string, unknown> | null
}
let mockHealth: SearchHealthSnapshot = { enabled: true, tables: [] }
let mockSearchHealthThrows: Error | null = null
async function readMockSearchHealth(): Promise<SearchHealthSnapshot> {
  if (mockSearchHealthThrows) throw mockSearchHealthThrows
  return mockHealth
}
mock.module('../../../src/core/search-registry', () => ({
  // The plugin-registration smoke test imports the full memory plugin,
  // whose activate() chain reaches `ensureRegisteredTables` via
  // memory-migration. Stub it as a no-op so activate() doesn't throw.
  ensureRegisteredTables: async () => {},
  buildSearchAPI: () => ({
    registerContentType: () => {},
    registerFileBackedContentType: () => {},
    index: async () => {},
    remove: async () => {},
    transform: async () => {},
    query: async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'fallback' as const } }),
  }),
}))

// memory-migration also reaches into search + offsets — stub the migrator
// itself so we don't need to mock its full deps tree.
mock.module('../../../plugins/memory/lib/memory-migration', () => ({
  migrateIfNeeded: async () => {},
  MEMORY_SCHEMA_VERSION: 1,
}))

// ttl-prune timer: avoid leaving a real setInterval alive.
mock.module('../../../plugins/memory/lib/ttl-prune', () => ({
  pruneExpired: async () => 0,
  startTtlTimer: () => {},
  stopTtlTimer: () => {},
}))

// Indexer constructor — only called inside the plugin smoke. Stub it.
mock.module('../../../plugins/memory/lib/indexer', () => ({
  MemoryIndexer: class { backfill = async () => {}; sync = async () => {}; remove = async () => {} },
}))

import { checkSearchTables } from '../../../plugins/memory/lib/health-checks'

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mockSearchEnabled = true
  mockSearchHealthThrows = null
  mockHealth = { enabled: true, tables: [] }
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── Inert returns when search is off / unreachable / disabled in registry ─

describe('checkSearchTables — quiescent paths', () => {
  it('returns no rows when search is disabled in settings', async () => {
    mockSearchEnabled = false
    const results = await checkSearchTables(readMockSearchHealth)
    expect(results).toEqual([])
  })

  it('warns when search is enabled but no content types are registered', async () => {
    const results = await checkSearchTables(readMockSearchHealth)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/no content types registered/)
  })

  it('returns no rows when search-registry reports the search subsystem disabled', async () => {
    mockHealth = { enabled: false, tables: [] }
    const results = await checkSearchTables(readMockSearchHealth)
    expect(results).toEqual([])
  })
})

// ─── Empty registry vs healthy aggregate ──────────────────────────────────

describe('checkSearchTables — registry shape', () => {
  it('warns when search is enabled but no content types are registered', async () => {
    mockHealth = { enabled: true, tables: [] }
    const results = await checkSearchTables(readMockSearchHealth)
    expect(results).toHaveLength(1)
    expect(results[0].check).toBe('search-tables')
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/no content types registered/)
  })

  it('reports an aggregate ok with total document count when stats are populated', async () => {
    mockHealth = {
      enabled: true,
      tables: [
        { table: 'tasks', pluginId: 'tasks', healthy: true, stats: { num_docs: 12 } },
        { table: 'projects', pluginId: 'projects', healthy: true, stats: { num_docs: 5 } },
      ],
    }
    const results = await checkSearchTables(readMockSearchHealth)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/2 tables, 17 total documents/)
  })

  it('falls back to a metadata-readable note when num_docs is unavailable for every table', async () => {
    mockHealth = {
      enabled: true,
      tables: [
        { table: 'tasks', pluginId: 'tasks', healthy: true, stats: { storage_status: { empty: false } } },
      ],
    }
    const results = await checkSearchTables(readMockSearchHealth)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/document counts unavailable from current search adapter API/)
  })
})

// ─── Per-table branches ───────────────────────────────────────────────────

describe('checkSearchTables — per-table branches', () => {
  it('warns about a table whose stats are unavailable', async () => {
    mockHealth = {
      enabled: true,
      tables: [{ table: 'tasks', pluginId: 'tasks', healthy: true, stats: null }],
    }
    const results = await checkSearchTables(readMockSearchHealth)
    expect(results.some(r => r.status === 'warn' && r.message.includes('stats unavailable'))).toBe(true)
  })

  it('reports schedule-table 0-doc count as ok with a runtime-only note', async () => {
    mockHealth = {
      enabled: true,
      tables: [{ table: 'schedule', pluginId: 'schedule', healthy: true, stats: { num_docs: 0 } }],
    }
    const results = await checkSearchTables(readMockSearchHealth)
    expect(results.some(r => r.status === 'ok' && r.message.includes('indexed at runtime'))).toBe(true)
  })

  it('reports a non-schedule table with 0-doc count as ok with reindex hint', async () => {
    mockHealth = {
      enabled: true,
      tables: [{ table: 'tasks', pluginId: 'tasks', healthy: true, stats: { num_docs: 0 } }],
    }
    const results = await checkSearchTables(readMockSearchHealth)
    expect(results.some(r => r.status === 'ok' && r.message.includes('reindex via POST /api/reindex?table=tasks'))).toBe(true)
  })

  it('reports a table with storage_status.empty as ok with reindex hint', async () => {
    mockHealth = {
      enabled: true,
      tables: [{ table: 'tasks', pluginId: 'tasks', healthy: true, stats: { storage_status: { empty: true } } }],
    }
    const results = await checkSearchTables(readMockSearchHealth)
    expect(results.some(r => r.status === 'ok' && r.message.includes('appears empty'))).toBe(true)
  })
})

// ─── Failure path ─────────────────────────────────────────────────────────

describe('checkSearchTables — failure path', () => {
  it('returns an error row when search health throws', async () => {
    mockSearchHealthThrows = new Error('connection refused')
    const results = await checkSearchTables(readMockSearchHealth)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('error')
    expect(results[0].message).toMatch(/connection refused/)
  })
})

// ─── Registration smoke test ──────────────────────────────────────────────

describe('plugin registration', () => {
  it('registers the search-tables health check on activate', async () => {
    const memoryPlugin = (await import('../../../plugins/memory')).default
    const registeredIds: string[] = []
    const noop = mock()
    const noopAsync = mock(async () => {})
    const ctx: Record<string, unknown> = {
      pluginId: 'memory',
      registerRoute: noop, registerExecTool: noop, registerNav: noop,
      registerSlot: noop, registerSkill: noop, registerWorkflow: noop,
      registerNodeType: noop, registerNotificationChannel: noop,
      registerHealthCheck: (def: { id: string }) => { registeredIds.push(def.id); return `memory.${def.id}` },
      watchFiles: noop,
      getSettings: () => ({ backfillDays: 0, skipSessionOverBytes: 0, skipResetBackups: false }),
      updateSettings: noop,
      activity: { log: noop, audit: noop },
      runtime: { memory: { watchPaths: async () => [] } },
      hooks: { register: () => () => {}, has: () => false, invoke: noopAsync },
      search: {
        registerContentType: noop, registerFileBackedContentType: noop,
        index: noopAsync, remove: noopAsync, transform: noopAsync,
        query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'fallback' as const } })),
        health: readMockSearchHealth,
      },
      storage: {},
      events: { on: noop, emit: noop, off: noop },
    }
    await memoryPlugin.activate(ctx as unknown as Parameters<typeof memoryPlugin.activate>[0])

    expect(registeredIds).toContain('search-tables')
  })
})
