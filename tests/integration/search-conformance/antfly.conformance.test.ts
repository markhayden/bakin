/**
 * Conformance suite vs a REAL ephemeral antfly (dev build or install).
 * Skips loudly when no binary is present. FTS-only — model-dependent
 * behavior lives in tests/integration/antfly/.
 */
import { describe, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-antfly-conf-${Date.now()}-${randomUUID()}`)
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
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { AntflySearchClient } from '../../../packages/adapter-antfly/src/client'
import { DEFAULT_SETTINGS } from '../../../packages/adapter-antfly/src/defaults'
import { isEngineUnavailable } from '../../../packages/core/src/adapters/search/errors'
import type { SearchAdapter } from '../../../packages/core/src/adapters/search'
import { resolveAntflyBinary, spawnEphemeralAntfly, type EphemeralAntfly } from './harness'
import { runSearchConformanceSuite, type ConformanceTarget } from './conformance'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const binary = resolveAntflyBinary()

if (!binary) {
  // eslint-disable-next-line no-console
  console.warn('⚠ search-conformance/antfly SKIPPED — no antfly binary (set BAKIN_ANTFLY_BIN or build the dev worktree; see tasks/evidence-search-rebuild.md P0.1)')
  describe.skip('search conformance: antfly (no binary)', () => {})
} else {
  let instance: EphemeralAntfly
  let target: ConformanceTarget

  /**
   * Writes racing a just-created table can transiently fail while the
   * shard group settles (probe-verified; in production the OUTBOX absorbs
   * this). The conformance wrapper retries unavailable-classified writes
   * briefly so cases exercise the contract, not the race.
   */
  function withWriteRetries(adapter: SearchAdapter): SearchAdapter {
    const retry = async <T>(fn: () => Promise<T>): Promise<T> => {
      let lastErr: unknown
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          return await fn()
        } catch (err) {
          lastErr = err
          if (!isEngineUnavailable(err)) throw err
          await sleep(250 * (attempt + 1))
        }
      }
      throw lastErr
    }
    // Explicit delegation — class methods live on the prototype, so a
    // spread would silently drop capabilities()/mappingFingerprint()/etc.
    return {
      name: adapter.name,
      version: adapter.version,
      requiredCoreVersion: adapter.requiredCoreVersion,
      initialize: adapter.initialize.bind(adapter),
      shutdown: adapter.shutdown.bind(adapter),
      available: adapter.available.bind(adapter),
      capabilities: adapter.capabilities?.bind(adapter),
      mappingFingerprint: adapter.mappingFingerprint?.bind(adapter),
      tables: adapter.tables,
      documents: {
        index: (t, k, d) => retry(() => adapter.documents.index(t, k, d)),
        batchIndex: (t, i) => retry(() => adapter.documents.batchIndex(t, i)),
        remove: (t, k) => retry(() => adapter.documents.remove(t, k)),
        batchRemove: (t, k) => retry(() => adapter.documents.batchRemove(t, k)),
        transform: (t, k, fn) => retry(() => adapter.documents.transform(t, k, fn)),
        get: (t, k) => retry(() => adapter.documents.get(t, k)),
      },
      query: adapter.query.bind(adapter),
      multiQuery: adapter.multiQuery.bind(adapter),
      scan: adapter.scan.bind(adapter),
    }
  }

  beforeAll(async () => {
    instance = await spawnEphemeralAntfly(binary)
    // Bun.fetch: the happy-dom test preload breaks global fetch for real HTTP.
    const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
    const client = new AntflySearchClient({ ...DEFAULT_SETTINGS, url: instance.url }, { fetchImpl: nativeFetch })
    target = {
      adapter: withWriteRetries(client),
      prefix: `conf_${Date.now().toString(36)}_`,
      realEngine: true,
      settle: async (table: string) => {
        const deadline = Date.now() + 15_000
        while (Date.now() < deadline) {
          const legs = await client.tables.health(table).catch(() => [])
          if (legs.length > 0 && legs.every((leg) => leg.state === 'ready')) return
          await sleep(200)
        }
      },
    }
  }, 150_000)

  afterAll(async () => {
    await instance?.stop()
  })

  runSearchConformanceSuite('antfly (real engine)', () => target)
}
