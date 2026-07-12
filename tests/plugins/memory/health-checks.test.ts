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
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

let mockSearchEnabled = true
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({
    search: { adapter: 'antfly', settings: { enabled: mockSearchEnabled } },
  }),
  resetSettingsCache: () => {},
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

interface MockTable {
  logical: string
  physical: string
  schemaVersion: number
  state: 'active' | 'migrating'
  phase: string | null
  pluginId: string
  healthy: boolean
  docCount: number | null
  legs: unknown[]
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
    query: async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'unavailable' as const } }),
  }),
}))

// (The old memory-migration stub is gone — the module was deleted in the
// search rebuild; blue/green schemaVersion migration replaced it.)

// ttl-prune timer: avoid leaving a real setInterval alive.
mock.module('../../../plugins/memory/lib/ttl-prune', () => ({
  pruneExpired: async () => 0,
  startTtlTimer: () => {},
  stopTtlTimer: () => {},
}))

// Indexer constructor — only called inside the plugin smoke. Stub it.
// buildMemoryDoc must exist too: routes/record.ts imports it at module load.
mock.module('../../../plugins/memory/lib/indexer', () => ({
  MemoryIndexer: class { backfill = async () => {}; sync = async () => {}; remove = async () => {} },
  buildMemoryDoc: (row: Record<string, unknown>) => row,
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
        { logical: 'tasks', physical: 'tasks_v1_x', schemaVersion: 1, state: 'active' as const, phase: null, pluginId: 'tasks', healthy: true, docCount: 12, lastIndexedAt: null, lastRebuildAt: null, journalPending: 0, legs: [] },
        { logical: 'projects', physical: 'projects_v1_x', schemaVersion: 1, state: 'active' as const, phase: null, pluginId: 'projects', healthy: true, docCount: 5, lastIndexedAt: null, lastRebuildAt: null, journalPending: 0, legs: [] },
      ],
    }
    const results = await checkSearchTables(readMockSearchHealth)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/2 tables, 17 total documents/)
  })

})

// ─── Per-table branches ───────────────────────────────────────────────────

describe('checkSearchTables — per-table branches', () => {
  it('warns about a table whose stats are unavailable', async () => {
    mockHealth = {
      enabled: true,
      tables: [{ logical: 'tasks', physical: 'tasks_v1_x', schemaVersion: 1, state: 'active' as const, phase: null, pluginId: 'tasks', healthy: true, docCount: null, lastIndexedAt: null, lastRebuildAt: null, journalPending: 0, legs: [] }],
    }
    const results = await checkSearchTables(readMockSearchHealth)
    expect(results.some(r => r.status === 'warn' && r.message.includes('doc count unavailable'))).toBe(true)
  })

  it('reports schedule-table 0-doc count as ok with a runtime-only note', async () => {
    mockHealth = {
      enabled: true,
      tables: [{ logical: 'schedule', physical: 'schedule_v1_x', schemaVersion: 1, state: 'active' as const, phase: null, pluginId: 'schedule', healthy: true, docCount: 0, lastIndexedAt: null, lastRebuildAt: null, journalPending: 0, legs: [] }],
    }
    const results = await checkSearchTables(readMockSearchHealth)
    expect(results.some(r => r.status === 'ok' && r.message.includes('indexed at runtime'))).toBe(true)
  })

  it('reports a non-schedule table with 0-doc count as ok with reindex hint', async () => {
    mockHealth = {
      enabled: true,
      tables: [{ logical: 'tasks', physical: 'tasks_v1_x', schemaVersion: 1, state: 'active' as const, phase: null, pluginId: 'tasks', healthy: true, docCount: 0, lastIndexedAt: null, lastRebuildAt: null, journalPending: 0, legs: [] }],
    }
    const results = await checkSearchTables(readMockSearchHealth)
    expect(results.some(r => r.status === 'ok' && r.message.includes('rebuild via POST /api/reindex?table=tasks'))).toBe(true)
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
        query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'unavailable' as const } })),
        health: readMockSearchHealth,
      },
      storage: {},
      events: { on: noop, emit: noop, off: noop },
    }
    await memoryPlugin.activate(ctx as unknown as Parameters<typeof memoryPlugin.activate>[0])

    expect(registeredIds).toContain('search-tables')
  })
})
