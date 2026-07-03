/**
 * THE F4 guarantee (spec D5): when the blue/green registry rows match the
 * registered content types, a boot performs ZERO search-adapter calls.
 * No scans, no reconcile, no warming, no list — nothing.
 */
import { describe, it, expect, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-bootnothing-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)
mock.module('../../src/core/watcher', () => ({
  registerSyncHook: () => () => {},
  registerUnlinkHook: () => () => {},
}))

import { createSearchAdapterHarness, installSearchAdapter, clearSearchAdapter } from '../helpers/search-adapter'
import { buildSearchAPI, createRegisteredTables, resetSearchRegistry } from '../../src/core/search-registry'
import { startSearchEngine } from '../../src/core/search-startup'
import { closeAllDbs } from '../../packages/core/src/storage/db'
import type { SearchAdapter } from '../../packages/core/src/adapters/search'

afterAll(() => {
  clearSearchAdapter()
  closeAllDbs()
  rmSync(testDir, { recursive: true, force: true })
})

/**
 * Wrap an adapter so every ENGINE call (any depth) increments a counter.
 * capabilities()/mappingFingerprint() are excluded: they are pure local
 * computations over adapter settings — no engine I/O — and the D5
 * guarantee is about engine work (no scans, no creates, no probes).
 */
const LOCAL_ONLY = new Set(['capabilities', 'mappingFingerprint'])
function countingProxy(base: SearchAdapter): { adapter: SearchAdapter; calls: () => number } {
  let calls = 0
  const wrap = <T extends object>(obj: T): T => new Proxy(obj, {
    get(target, prop) {
      const value = Reflect.get(target, prop)
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          if (!LOCAL_ONLY.has(String(prop))) calls++
          return (value as (...a: unknown[]) => unknown).apply(target, args)
        }
      }
      if (value && typeof value === 'object') return wrap(value as object)
      return value
    },
  })
  return { adapter: wrap(base), calls: () => calls }
}

describe('boot does nothing (D5)', () => {
  it('a matching registry performs ZERO adapter calls through table setup + engine start', async () => {
    const harness = createSearchAdapterHarness()
    installSearchAdapter(harness.adapter)
    resetSearchRegistry()

    // First boot: register + create + seed (the one-time create event).
    const api = buildSearchAPI('tasks')
    api.registerContentType({
      table: 'tasks',
      schemaVersion: 1,
      schema: { title: { type: 'text' as const } },
      searchableFields: ['title'],
      embeddingTemplate: '{{title}}',
      reindex: async function* () {
        yield { key: 't1', doc: { title: 'seeded' } }
      },
      verifyExists: async () => true,
    })
    await createRegisteredTables()

    // Second boot: same registration state, adapter wrapped in a call spy.
    // Installed WITHOUT the helper (which resets outbox + table registry —
    // the exact state this test needs to keep).
    const { adapter: spied, calls } = countingProxy(harness.adapter)
    ;(globalThis as Record<string, unknown>).__bakinAppServices = { search: spied }
    // Re-run the boot-path table setup + engine start against the spy.
    const registry = (globalThis as Record<string, unknown>).__bakinSearchRegistry as { tablesCreated: boolean } | undefined
    if (registry) registry.tablesCreated = false
    await createRegisteredTables()
    await startSearchEngine()

    expect(calls()).toBe(0)
  })
})
