/**
 * Memory-plugin-owned doctor check.
 *
 * Migrated out of src/core/doctor.ts (#139 C5). Behavioral coverage
 * for checkSearchTables — antfly-disabled / antfly-unavailable /
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

let mockAntflyEnabled = true
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({
    antfly: { enabled: mockAntflyEnabled },
    doctor: { autoFixSkill: false },
  }),
  resetSettingsCache: () => {},
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

let mockAntflyAvailable = true
let mockAntflyInitThrows: Error | null = null
mock.module('../../../src/core/antfly', () => ({
  initialize: async () => {
    if (mockAntflyInitThrows) throw mockAntflyInitThrows
  },
  available: () => mockAntflyAvailable,
}))

interface MockTable {
  table: string
  pluginId: string
  healthy: boolean
  stats?: Record<string, unknown> | null
}
let mockHealth: { enabled: boolean; tables: MockTable[] } = { enabled: true, tables: [] }
mock.module('../../../src/core/search-registry', () => ({
  getSearchHealth: async () => mockHealth,
}))

import { checkSearchTables } from '../../../plugins/memory/lib/health-checks'

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mockAntflyEnabled = true
  mockAntflyAvailable = true
  mockAntflyInitThrows = null
  mockHealth = { enabled: true, tables: [] }
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── Inert returns when antfly is off / unreachable / disabled in registry ─

describe('checkSearchTables — quiescent paths', () => {
  it('returns no rows when antfly is disabled in settings', async () => {
    mockAntflyEnabled = false
    const results = await checkSearchTables()
    expect(results).toEqual([])
  })

  it('returns no rows when antfly is enabled but unavailable (other check surfaces it)', async () => {
    mockAntflyAvailable = false
    const results = await checkSearchTables()
    expect(results).toEqual([])
  })

  it('returns no rows when search-registry reports the search subsystem disabled', async () => {
    mockHealth = { enabled: false, tables: [] }
    const results = await checkSearchTables()
    expect(results).toEqual([])
  })
})

// ─── Empty registry vs healthy aggregate ──────────────────────────────────

describe('checkSearchTables — registry shape', () => {
  it('warns when antfly is enabled but no content types are registered', async () => {
    mockHealth = { enabled: true, tables: [] }
    const results = await checkSearchTables()
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
    const results = await checkSearchTables()
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
    const results = await checkSearchTables()
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/document counts unavailable from current Antfly API/)
  })
})

// ─── Per-table branches ───────────────────────────────────────────────────

describe('checkSearchTables — per-table branches', () => {
  it('warns about a table whose stats are unavailable', async () => {
    mockHealth = {
      enabled: true,
      tables: [{ table: 'tasks', pluginId: 'tasks', healthy: true, stats: null }],
    }
    const results = await checkSearchTables()
    expect(results.some(r => r.status === 'warn' && r.message.includes('stats unavailable'))).toBe(true)
  })

  it('reports schedule-table 0-doc count as ok with a runtime-only note', async () => {
    mockHealth = {
      enabled: true,
      tables: [{ table: 'schedule', pluginId: 'schedule', healthy: true, stats: { num_docs: 0 } }],
    }
    const results = await checkSearchTables()
    expect(results.some(r => r.status === 'ok' && r.message.includes('indexed at runtime'))).toBe(true)
  })

  it('reports a non-schedule table with 0-doc count as ok with reindex hint', async () => {
    mockHealth = {
      enabled: true,
      tables: [{ table: 'tasks', pluginId: 'tasks', healthy: true, stats: { num_docs: 0 } }],
    }
    const results = await checkSearchTables()
    expect(results.some(r => r.status === 'ok' && r.message.includes('reindex via POST /api/reindex?table=tasks'))).toBe(true)
  })

  it('reports a table with storage_status.empty as ok with reindex hint', async () => {
    mockHealth = {
      enabled: true,
      tables: [{ table: 'tasks', pluginId: 'tasks', healthy: true, stats: { storage_status: { empty: true } } }],
    }
    const results = await checkSearchTables()
    expect(results.some(r => r.status === 'ok' && r.message.includes('appears empty'))).toBe(true)
  })
})

// ─── Failure path ─────────────────────────────────────────────────────────

describe('checkSearchTables — failure path', () => {
  it('returns an error row when the antfly initialize call throws', async () => {
    mockAntflyInitThrows = new Error('connection refused')
    const results = await checkSearchTables()
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('error')
    expect(results[0].message).toMatch(/connection refused/)
  })
})
