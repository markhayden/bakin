/**
 * Workaround-regression pins (spec D2): every workaround the adapter still
 * carries is pinned by a test that FAILS when upstream fixes it — dead
 * workarounds announce themselves instead of rotting.
 *
 * Each case asserts the CURRENT (broken/limited) upstream behavior. When a
 * pin fails after an antfly upgrade: delete the corresponding workaround
 * (noted per test), then delete the pin.
 *
 * FTS-only — runs without inference models. Loud skip without a binary.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-antfly-pins-${Date.now()}-${randomUUID()}`)
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

import { resolveAntflyBinary, spawnEphemeralAntfly, type EphemeralAntfly } from '../search-conformance/harness'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
const binary = resolveAntflyBinary()

if (!binary) {
  // eslint-disable-next-line no-console
  console.warn('⚠ antfly workaround-regression pins SKIPPED — no antfly binary (see tasks/evidence-search-rebuild.md P0.1)')
  describe.skip('antfly workaround pins (no binary)', () => {})
} else {
  let instance: EphemeralAntfly
  const T = 'pins'

  async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
    const response = await nativeFetch(`${instance.url}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const text = await response.text()
    let json: unknown = text
    try { json = JSON.parse(text) } catch { /* raw text */ }
    return { status: response.status, json }
  }
  const resp0 = (j: unknown) => (j as { responses?: Array<Record<string, unknown>> })?.responses?.[0]

  beforeAll(async () => {
    instance = await spawnEphemeralAntfly(binary)
    await api('POST', `/db/v1/tables/${T}`, { num_shards: 1 })
    // brief settle so the batch doesn't race table provisioning
    await sleep(1000)
    for (let attempt = 0; attempt < 8; attempt++) {
      const ins = await api('POST', `/db/v1/tables/${T}/batch`, {
        inserts: {
          d1: { title: 'alpha cats', n: 1 },
          d2: { title: 'beta dogs', n: 2 },
          d3: { title: 'gamma cats', n: 3 },
        },
        sync_level: 'full_index',
      })
      if (ins.status < 300) break
      await sleep(500)
    }
  }, 150_000)

  afterAll(async () => {
    await instance?.stop()
  })

  describe('antfly workaround pins', () => {
    it('PIN: order_by is rejected by the Zig engine (query_contract.zig hard-reject)', async () => {
      // WHEN THIS FAILS: upstream added order_by support → implement sort in
      // translate.ts (Query.sort → order_by [{field, desc}]) + delete this pin.
      const result = await api('POST', `/db/v1/tables/${T}/query`, {
        full_text_search: { match_all: {} },
        order_by: [{ field: 'n', desc: true }],
        limit: 3,
      })
      expect(result.status).toBe(400)
    })

    it('PIN: totals are page-scoped without count:true', async () => {
      // WHEN THIS FAILS: totals became true corpus counts → drop the
      // companion-count twin in client.query + delete this pin.
      const result = await api('POST', `/db/v1/tables/${T}/query`, {
        full_text_search: { match_all: {} },
        limit: 1,
      })
      const hits = resp0(result.json)?.hits as { total: number } | undefined
      expect(result.status).toBe(200)
      expect(hits?.total).toBe(1) // page-scoped: NOT the corpus size (3)
    })

    it('PIN: sync_level aknn stays removed (breaking change absorbed)', async () => {
      // WHEN THIS FAILS: aknn came back (unlikely) — no action needed, we
      // send full_index; delete this pin.
      const result = await api('POST', `/db/v1/tables/${T}/batch`, {
        inserts: { x: { title: 'aknn probe' } },
        sync_level: 'aknn',
      })
      expect(result.status).toBeGreaterThanOrEqual(400)
    })

    it('PIN: lookup without a body is rejected (client always sends {})', async () => {
      // WHEN THIS FAILS: bodyless lookup became legal → optional cleanup in
      // client.scan + delete this pin.
      const result = await api('POST', `/db/v1/tables/${T}/lookup`)
      expect(result.status).toBeGreaterThanOrEqual(400)
    })

    it('CONTRACT CANARY: filter_query keeps filtering (the workaround we DELETED must stay dead)', async () => {
      // Inverse pin: this asserts the FIX keeps working. If it fails, the
      // filter-in-AST workaround has to come back (bakin#456 class).
      const result = await api('POST', `/db/v1/tables/${T}/query`, {
        full_text_search: { match_all: {} },
        filter_query: { match: 'cats', field: 'title' },
        limit: 10,
      })
      const hits = resp0(result.json)?.hits as { hits: unknown[] } | undefined
      expect(result.status).toBe(200)
      expect(hits?.hits).toHaveLength(2)
    })
  })
}
