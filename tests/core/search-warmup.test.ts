/**
 * Warm-signal contract: the boot-time warm-up flips the process-wide signal
 * cold → warm once the query-embedding path answers quickly, and the signal
 * NEVER depends on indexing backlog. Search bars gate their "warming up"
 * indicator (display-only — input is never blocked) on exactly this state;
 * backlog/failed-backfill detail belongs to the health page instead.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const isolationDir = join(tmpdir(), `bakin-test-search-warmup-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => isolationDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => isolationDir,
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import {
  getSearchWarmState,
  warmSearchQueryPath,
  _resetSearchWarmStateForTests,
} from '../../src/core/search-warmup'
import { getRegistry, resetSearchRegistry } from '../../src/core/search-registry-core'
import { clearSearchAdapter, createSearchAdapterHarness, installSearchAdapter } from '../helpers/search-adapter'

let searchHarness: ReturnType<typeof createSearchAdapterHarness>

beforeEach(() => {
  resetSearchRegistry()
  _resetSearchWarmStateForTests()
  searchHarness = createSearchAdapterHarness()
  installSearchAdapter(searchHarness.adapter)
})

afterEach(() => {
  clearSearchAdapter()
  resetSearchRegistry()
  _resetSearchWarmStateForTests()
})

function registerWarmTable(table: string, pluginId: string): void {
  getRegistry().contentTypes.set(table, {
    table,
    pluginId,
    schema: {},
    searchableFields: [],
    embeddingTemplate: '',
    reindex: async function* () {},
    verifyExists: async () => true,
  })
}

describe('warmSearchQueryPath', () => {
  it('flips cold → warm once a probe round answers fast', async () => {
    registerWarmTable('bakin_tasks', 'tasks')
    expect(getSearchWarmState()).toBe('cold')

    await warmSearchQueryPath()

    expect(getSearchWarmState()).toBe('warm')
  })

  it('reports warm immediately when search is unavailable — never a stuck boot indicator', async () => {
    registerWarmTable('bakin_tasks', 'tasks')
    searchHarness.setAvailable(false)

    await warmSearchQueryPath()

    expect(getSearchWarmState()).toBe('warm')
  })

  it('is idempotent — a second call does not restart the probe loop', async () => {
    registerWarmTable('bakin_tasks', 'tasks')
    await warmSearchQueryPath()
    const probesAfterFirst = searchHarness.calls.query.mock.calls.length

    await warmSearchQueryPath()

    expect(searchHarness.calls.query.mock.calls.length).toBe(probesAfterFirst)
  })
})
