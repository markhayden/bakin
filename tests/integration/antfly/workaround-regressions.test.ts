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
import { homedir } from 'os'
import { existsSync } from 'fs'
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
    instance = await spawnEphemeralAntfly(binary, { modelOwners: ['BAAI', 'antflydb'], preloadModels: ['embedder:antflydb/clipclap'] })
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

    it('PIN antfly#319: mixed-corpus media leg — raw flags stuck building, health() overrides to ready', async () => {
      // WHEN THE CANARY HALF FAILS (raw backfill_state becomes 'ready'):
      // upstream fixed the skip accounting → delete the idle-detection
      // override in mapIndexStatuses + this pin.
      if (!instance.modelsAvailable || !existsSync(join(homedir(), '.antfly', 'inference', 'models', 'antflydb', 'clipclap'))) {
        console.warn('⚠ antfly#319 pin skipped — clipclap model not present')
        return
      }
      const T2 = 'pins_mixed'
      await api('POST', `/db/v1/tables/${T2}`, {
        num_shards: 1,
        indexes: { vis: { name: 'vis', type: 'embeddings', template: '{{#if media_url}}{{remoteMedia url=media_url}}{{/if}}', dimension: 512, embedder: { provider: 'antfly', model: 'antflydb/clipclap' } } },
      })
      await sleep(1200)
      const png = join(instance.root, 'pin319.png')
      const { solidPng } = await import('./golden-queries')
      const { writeFileSync } = await import('node:fs')
      writeFileSync(png, solidPng([255, 0, 0]))
      for (let i = 0; i < 10; i++) {
        const r = await api('POST', `/db/v1/tables/${T2}/batch`, {
          inserts: { m1: { title: 'red', media_url: `file://${png}` }, p1: { title: 'plain doc' } },
          sync_level: 'full_index',
        })
        if (r.status < 300) break
        await sleep(500)
      }
      // wait until the one embeddable doc is indexed and the pipeline is idle
      let raw: Record<string, unknown> | null = null
      for (let i = 0; i < 120; i++) {
        const st = await api('GET', `/db/v1/tables/${T2}/indexes`)
        const entries = Array.isArray(st.json) ? st.json as Array<{ config?: { name?: string }; status?: Record<string, unknown> }> : []
        const vis = entries.find((e) => e.config?.name === 'vis')?.status ?? null
        const runtime = vis?.enrichment_runtime as { pending_sequence_count?: number; active_embed_batch_items?: number } | undefined
        if (vis && (vis.total_indexed as number) >= 1 && runtime?.pending_sequence_count === 0 && (runtime?.active_embed_batch_items ?? 0) === 0) {
          raw = vis
          break
        }
        await sleep(1000)
      }
      expect(raw).not.toBeNull()
      // CANARY: raw flags still lie (building forever) — when this flips,
      // delete the workaround.
      expect(raw!.backfill_state).toBe('running')
      expect(raw!.rebuilding === true || raw!.backfill_active === true).toBe(true)
      // WORKAROUND GUARD: our health mapping overrides to ready.
      const { AntflySearchClient } = await import('../../../packages/adapter-antfly/src/client')
      const { DEFAULT_SETTINGS } = await import('../../../packages/adapter-antfly/src/defaults')
      const client = new AntflySearchClient({ ...DEFAULT_SETTINGS, url: instance.url }, { fetchImpl: nativeFetch })
      const legs = await client.tables.health(T2)
      const vis = legs.find((l) => l.leg === 'vis')
      expect(vis?.state).toBe('ready')
      expect(vis?.indexedCount).toBe(1)
    }, 180_000)

    it('PIN antfly#322: a WebP media_url fails the ENTIRE batch (engine decodes PNG/JPEG/GIF only)', async () => {
      // WHEN THIS FAILS: upstream added WebP decode (or per-doc batch errors)
      // → widen EMBED_SAFE_RE in plugins/assets/lib/search-doc.ts (and
      // consider passing originals again) + delete this pin.
      if (!instance.modelsAvailable || !existsSync(join(homedir(), '.antfly', 'inference', 'models', 'antflydb', 'clipclap'))) {
        console.warn('⚠ webp pin skipped — clipclap model not present')
        return
      }
      const T3 = 'pins_webp'
      await api('POST', `/db/v1/tables/${T3}`, {
        num_shards: 1,
        indexes: { vis: { name: 'vis', type: 'embeddings', template: '{{#if media_url}}{{remoteMedia url=media_url}}{{/if}}', dimension: 512, embedder: { provider: 'antfly', model: 'antflydb/clipclap' } } },
      })
      await sleep(1200)
      const sharp = (await import('sharp')).default
      const webp = join(instance.root, 'pin-webp.webp')
      await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 120, b: 40 } } }).webp().toFile(webp)
      // Retry loop mirrors beforeAll: early attempts can race table
      // provisioning (transient non-2xx). The pinned behavior is that the
      // batch NEVER lands — including the innocent sibling doc.
      let status = 0
      for (let i = 0; i < 10; i++) {
        const r = await api('POST', `/db/v1/tables/${T3}/batch`, {
          inserts: { w1: { title: 'tacos', media_url: `file://${webp}` }, ok1: { title: 'innocent sibling' } },
          sync_level: 'full_index',
        })
        status = r.status
        if (r.status === 500 || r.status < 300) break
        await sleep(500)
      }
      expect(status).toBe(500)
    }, 120_000)

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
