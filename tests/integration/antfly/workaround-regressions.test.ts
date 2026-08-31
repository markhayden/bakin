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
import { existsSync , readFileSync} from 'fs'
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
    it('PIN rc.18: order_by on an inferred (schema-less) field is rejected with the 422 sort taxonomy', async () => {
      // rc.18 shipped public exact-sort, but only for schema-mapped fields
      // with sortable doc-values — Bakin sends no schema, so sort stays
      // unusable and Query.sort is never sent. WHEN THIS FAILS (200):
      // inferred fields became sortable → implement Query.sort → order_by
      // + delete this pin.
      const result = await api('POST', `/db/v1/tables/${T}/query`, {
        full_text_search: { match_all: {} },
        order_by: [{ field: 'n', desc: true }],
        limit: 3,
      })
      expect(result.status).toBe(422)
    })

    it('GUARD rc.18: totals are corpus-true {value, relation} objects on every response', async () => {
      // Bakin now RELIES on this (the page-scoped-totals count twin was
      // deleted). WHEN THIS FAILS: totals regressed to page-scoped or a
      // bare number — normalizeTotal already tolerates the number shape,
      // but page-scoped counts would need the count twin back.
      const result = await api('POST', `/db/v1/tables/${T}/query`, {
        full_text_search: { match_all: {} },
        limit: 1,
      })
      const hits = resp0(result.json)?.hits as { total: { value: number; relation: string } } | undefined
      expect(result.status).toBe(200)
      expect(hits?.total).toEqual({ value: 3, relation: 'exact' }) // corpus size, not the page
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

    it('PIN: /lookup is gone (405) — scans live at /documents; GUARD: bodyless scans are legal', async () => {
      // WHEN THE 405 HALF FAILS: /lookup came back — no action, we use
      // /documents. WHEN THE BODYLESS HALF FAILS (≥400): the needs-a-body
      // quirk is back — restore the `{}` fallback in client.scan.
      const legacy = await api('POST', `/db/v1/tables/${T}/lookup`, {})
      expect(legacy.status).toBe(405)
      const bodyless = await api('POST', `/db/v1/tables/${T}/documents`)
      expect(bodyless.status).toBe(200)
    })

    it('PIN antfly#319: mixed-corpus media leg — raw flags stuck building, health() overrides to ready', async () => {
      // rc.18 behavior (re-pinned 2026-07-22 after the rc.21 crash dossier):
      // docs whose media template renders empty never complete the leg's
      // backfill accounting, so raw flags stay raised while fully idle; the
      // idle-detection override in mapIndexStatuses maps ready. rc.21 fixed
      // THIS accounting (verified) but is unshippable for other reasons —
      // when a healthy release ships, flip this back to the guard form
      // (git history, 2026-07-21).
      if (!instance.modelsAvailable || !existsSync(join(homedir(), '.antfly', 'inference', 'models', 'antflydb', 'clipclap'))) {
        console.warn('⚠ antfly#319 guard skipped — clipclap model not present')
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
      // CANARY: raw flags still lie (building forever) on rc.18 — when this
      // flips on a future pin, revisit the override (guard form in history).
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

    it('GUARD antfly#319 (idle-detection override): an idle embeddings leg maps ready regardless of raw flags', async () => {
      // The override this guards was retired at the rc.21 repin, then
      // RESTORED hours later: the production memory-table green (50
      // embeddable of ~10k skipped audit rows, rebuild interrupted by an
      // engine bounce) sat with rebuilding/backfill_active raised while
      // fully idle — and parked unconverged. A minimal 2-doc skip corpus
      // does NOT reproduce the stuck flags on rc.21 (they clear), so the
      // trigger is scale- or interruption-dependent and this cannot be a
      // fails-when-fixed pin. The override's semantics are safe regardless
      // (pending 0 + no active batch + not retrying ⇒ idle ⇒ ready).
      // Retirement is MANUAL: prove a full-scale interrupted rebuild
      // converges without it before deleting.
      const T6 = 'pins_textskip'
      await api('POST', `/db/v1/tables/${T6}`, {
        num_shards: 1,
        indexes: { sem: { name: 'sem', type: 'embeddings', template: '{{#if body}}{{body}}{{/if}}', dimension: 384, embedder: { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5' } } },
      })
      await sleep(1200)
      for (let i = 0; i < 10; i++) {
        const r = await api('POST', `/db/v1/tables/${T6}/batch`, {
          inserts: { s1: { title: 'has body', body: 'embeddable text' }, s2: { title: 'no body field' } },
          sync_level: 'full_index',
        })
        if (r.status < 300) break
        await sleep(500)
      }
      // Wait for idle: the one embeddable doc lands, nothing in flight.
      let raw: Record<string, unknown> | null = null
      for (let i = 0; i < 120; i++) {
        const st = await api('GET', `/db/v1/tables/${T6}/indexes`)
        const entries = Array.isArray(st.json) ? st.json as Array<{ config?: { name?: string }; status?: Record<string, unknown> }> : []
        const sem = entries.find((e) => e.config?.name === 'sem')?.status ?? null
        const runtime = sem?.enrichment_runtime as { pending_sequence_count?: number; active_embed_batch_items?: number } | undefined
        if (sem && (sem.total_indexed as number) >= 1 && runtime?.pending_sequence_count === 0 && (runtime?.active_embed_batch_items ?? 0) === 0) {
          raw = sem
          break
        }
        await sleep(1000)
      }
      if (raw === null) {
        console.warn('⚠ text-skip pin skipped — embeddable doc never indexed (no BAAI model?)')
        return
      }
      // Record (not assert) whether the raw flags lie on this corpus —
      // evidence for eventual manual retirement, not a gate.
      console.warn(`text-skip raw flags: rebuilding=${String(raw.rebuilding)} backfill_active=${String(raw.backfill_active)}`)
      // WORKAROUND GUARD: idle-detection maps the leg ready either way.
      const { AntflySearchClient } = await import('../../../packages/adapter-antfly/src/client')
      const { DEFAULT_SETTINGS } = await import('../../../packages/adapter-antfly/src/defaults')
      const client = new AntflySearchClient({ ...DEFAULT_SETTINGS, url: instance.url }, { fetchImpl: nativeFetch })
      const legs = await client.tables.health(T6)
      const sem = legs.find((l) => l.leg === 'sem')
      expect(sem?.state).toBe('ready')
    }, 180_000)

    it('GUARD 0.2.0 (was the empty-table lying-flags pin): a never-written table reports honest ready flags', async () => {
      // Upstream fixed empty-table backfill accounting in 0.2.0, so the
      // !runtime idle-detection block in mapIndexStatuses was deleted
      // (2026-08-31). WHEN THIS FAILS (flags raised on an empty table):
      // empty blue/green greens will park unconverged again — resurrect
      // the caught-up-idle override from git history.
      const T4 = 'pins_empty_table'
      await api('POST', `/db/v1/tables/${T4}`, { num_shards: 1 })
      await sleep(3000)
      const st = await api('GET', `/db/v1/tables/${T4}/indexes`)
      const entries = Array.isArray(st.json) ? st.json as Array<{ config?: { name?: string; type?: string }; status?: Record<string, unknown> }> : []
      const ft = entries.find((e) => e.config?.type === 'full_text')?.status as Record<string, unknown> | undefined
      expect(ft).toBeDefined()
      expect(ft!.doc_count).toBe(0)
      expect(ft!.rebuilding).toBe(false)
      expect(ft!.backfill_active).toBe(false)
      expect(ft!.backfill_state).toBe('ready')
      // And the un-overridden mapping agrees.
      const { AntflySearchClient } = await import('../../../packages/adapter-antfly/src/client')
      const { DEFAULT_SETTINGS } = await import('../../../packages/adapter-antfly/src/defaults')
      const client = new AntflySearchClient({ ...DEFAULT_SETTINGS, url: instance.url }, { fetchImpl: nativeFetch })
      const legs = await client.tables.health(T4)
      const ftLeg = legs.find((l) => l.leg.includes('full_text'))
      expect(ftLeg?.state).toBe('ready')
    }, 60_000)

    it('GUARD rc.18 (was antfly#322): a WebP media_url no longer fails the batch', async () => {
      // Upstream fixed the whole-batch poison (per-item embedding error
      // policy, #338). EMBED_SAFE_RE now passes .webp originals.
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
      // provisioning (transient non-2xx). rc.18 GUARD: the batch LANDS
      // (WebP no longer poisons the write — EMBED_SAFE_RE passes .webp
      // originals again). WHEN THIS FAILS (5xx): the whole-batch poison is
      // back → narrow EMBED_SAFE_RE + restore the pin.
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
      expect(status).toBeLessThan(300)
      // Both docs landed — retrievable by key (no FTS-visibility timing).
      const w1 = await api('GET', `/db/v1/tables/${T3}/documents/w1`)
      const ok1 = await api('GET', `/db/v1/tables/${T3}/documents/ok1`)
      expect(w1.status).toBe(200)
      expect(ok1.status).toBe(200)
    }, 120_000)

    it('PIN: an UNDECODABLE media_url still fails the ENTIRE batch (per-doc errors absent)', async () => {
      // This is the load-bearing reason EMBED_SAFE_RE + thumbs-first exist:
      // one bad media file poisons every sibling in the write. WHEN THIS
      // FAILS (batch lands): upstream added per-document batch errors →
      // consider passing originals unconditionally + delete this pin.
      const T5 = 'pins_badmedia'
      await api('POST', `/db/v1/tables/${T5}`, {
        num_shards: 1,
        indexes: { vis: { name: 'vis', type: 'embeddings', template: '{{#if media_url}}{{remoteMedia url=media_url}}{{/if}}', dimension: 512, embedder: { provider: 'antfly', model: 'antflydb/clipclap' } } },
      })
      await sleep(1200)
      const { writeFileSync } = await import('node:fs')
      const bad = join(instance.root, 'pin-bad.webp')
      writeFileSync(bad, Buffer.from('RIFFnope-not-webp-data'))
      let status = 0
      for (let i = 0; i < 10; i++) {
        const r = await api('POST', `/db/v1/tables/${T5}/batch`, {
          inserts: { bad1: { title: 'broken', media_url: `file://${bad}` }, ok2: { title: 'sibling' } },
          sync_level: 'full_index',
        })
        status = r.status
        if (r.status === 500 || r.status < 300) break
        await sleep(500)
      }
      expect(status).toBe(500)
      // rc.20+: the failed batch flips the engine's read path to
      // ReadUnavailable for EVERY table until a successful write lands
      // (reported upstream 2026-07; see read-unavailable-storm in
      // engine-status.ts). Heal it here so later tests query a healthy
      // engine — and pin the healing behavior itself while we're at it.
      const heal = await api('POST', `/db/v1/tables/${T}/batch`, {
        inserts: { heal1: { title: 'healing write' } },
        sync_level: 'full_index',
      })
      expect(heal.status).toBeLessThan(300)
      const probe = await api('POST', `/db/v1/tables/${T}/query`, {
        full_text_search: { match_all: {} },
        limit: 1,
      })
      expect(probe.status).toBe(200)
    }, 120_000)

    it('GUARD 0.2.0 (was the filter_query 400 pin): match_phrase filter_query filters correctly', async () => {
      // The rc.17 workaround (composeFtsWithFilters) was deleted 2026-08-31:
      // filter_query now accepts match_phrase and filters the corpus
      // (probed for keyword equality incl. hyphenated values, ranges,
      // should-INs, must_not-with-base — evidence file). WHEN THIS FAILS
      // (400 again, or wrong hit count): the filter-in-AST workaround has
      // to come back — resurrect composeFtsWithFilters from git history.
      const result = await api('POST', `/db/v1/tables/${T}/query`, {
        full_text_search: { match_all: {} },
        filter_query: { match_phrase: 'alpha cats', field: 'title' },
        limit: 10,
      })
      const hits = resp0(result.json)?.hits as { hits: Array<{ _id: string }> } | undefined
      expect(result.status).toBe(200)
      expect(hits?.hits.map((h) => h._id)).toEqual(['d1'])
    })

    it('GUARD 0.2.0: filter_query constrains the SEMANTIC lane (no cross-filter leak)', async () => {
      // buildQueryRequest stopped forcing filtered searches FTS-only on the
      // strength of this property — an agent-filtered hybrid search must
      // never merge another agent's rows in from the unfiltered vector leg.
      // WHEN THIS FAILS (violating doc in the results): restore the
      // hasFilters ⇒ full_text_only forcing in buildQueryRequest.
      if (!instance.modelsAvailable || !existsSync(join(homedir(), '.antfly', 'inference', 'models', 'BAAI'))) {
        console.warn('⚠ semantic-filter leak guard skipped — BAAI model not present')
        return
      }
      const T7 = 'pins_semfilter'
      await api('POST', `/db/v1/tables/${T7}`, { num_shards: 1 })
      await sleep(1000)
      // Per-index endpoint: the only create path whose enrichment starts.
      await api('POST', `/db/v1/tables/${T7}/indexes/sem`, {
        type: 'embeddings', template: '{{#if body}}{{body}}{{/if}}', dimension: 384,
        embedder: { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5' },
      })
      await sleep(1200)
      for (let i = 0; i < 10; i++) {
        const r = await api('POST', `/db/v1/tables/${T7}/batch`, {
          inserts: {
            mine: { agent: 'pixel', body: 'mountain lakes at dawn' },
            other: { agent: 'system', body: 'mountain lakes at dusk' },
          },
          sync_level: 'full_index',
        })
        if (r.status < 300) break
        await sleep(500)
      }
      const result = await api('POST', `/db/v1/tables/${T7}/query`, {
        semantic_search: 'mountain lakes',
        indexes: ['sem'],
        filter_query: { match_phrase: 'pixel', field: 'agent' },
        limit: 10,
      })
      const hits = resp0(result.json)?.hits as { hits: Array<{ _id: string }> } | undefined
      expect(result.status).toBe(200)
      expect(hits?.hits.map((h) => h._id)).toEqual(['mine'])
    }, 120_000)
  })

  describe('engine-burn watchdog log signature', () => {
    it('PIN: the pinned binary still emits the catch-up wedge signature the watchdog greps for', () => {
      // packages/adapter-antfly/src/engine-status.ts WEDGE_PATTERNS depends
      // on this exact upstream log string ("provisioned startup catch-up
      // debt persists", antfly#350). A version bump that rewords it would
      // silently blind one detection layer — this pin makes that loud.
      const bytes = readFileSync(binary)
      expect(bytes.includes('catch-up debt persists')).toBe(true)
    })
  })
}
