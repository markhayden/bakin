/**
 * AntflySearchClient unit tests — scripted fetch, no real engine.
 * The real-engine contract is covered by the conformance suite (A7).
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-antfly-client-${Date.now()}-${randomUUID()}`)
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

import { AntflySearchClient } from '../../packages/adapter-antfly/src/client'
import { DEFAULT_SETTINGS } from '../../packages/adapter-antfly/src/defaults'
import {
  SearchEngineUnavailableError,
  SearchRequestRejectedError,
} from '../../packages/core/src/adapters/search/errors'

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>

function scriptedFetch(routes: Array<{ match: (url: string, init?: RequestInit) => boolean; handle: Route }>): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    for (const route of routes) {
      if (route.match(url, init)) return route.handle(url, init)
    }
    throw new Error(`unrouted fetch: ${init?.method ?? 'GET'} ${url}`)
  }) as unknown as typeof fetch
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function makeClient(routes: Array<{ match: (url: string, init?: RequestInit) => boolean; handle: Route }>) {
  return new AntflySearchClient(DEFAULT_SETTINGS, { fetchImpl: scriptedFetch(routes) })
}

describe('error taxonomy', () => {
  it('network failure → SearchEngineUnavailableError', async () => {
    const client = new AntflySearchClient(DEFAULT_SETTINGS, {
      fetchImpl: (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch,
    })
    expect(client.documents.index('t', 'k', { a: 1 })).rejects.toThrow(SearchEngineUnavailableError)
  })

  it('5xx → SearchEngineUnavailableError; 4xx → SearchRequestRejectedError', async () => {
    const five = makeClient([{ match: () => true, handle: () => new Response('boom', { status: 503 }) }])
    expect(five.documents.index('t', 'k', {})).rejects.toThrow(SearchEngineUnavailableError)
    const four = makeClient([{ match: () => true, handle: () => new Response('bad shape', { status: 400 }) }])
    expect(four.documents.index('t', 'k', {})).rejects.toThrow(SearchRequestRejectedError)
  })
})

describe('query', () => {
  it('unwraps the responses[] envelope, maps _id/_index_scores, and normalizes object totals', async () => {
    const client = makeClient([
      {
        match: (url, init) => url.includes('/query') && init?.method === 'POST',
        handle: () => json({
          responses: [{
            hits: {
              // rc.18: corpus-true object total on every response
              total: { value: 42, relation: 'exact' },
              max_score: 0.9,
              hits: [{ _id: 'a', _score: 0.9, _index_scores: { full_text: 0.7, sem: -0.2 }, _source: { title: 'x' }, _sort: null }],
            },
            aggregations: null, took: 2, status: 200, error: null, table: 't',
          }],
        }),
      },
    ])
    const result = await client.query('t', { text: 'x', adapterOptions: { indexes: ['sem'] } })
    expect(result.hits[0].key).toBe('a')
    expect(result.hits[0].scoreBreakdown).toEqual({ full_text: 0.7, sem: -0.2 })
    expect(result.total).toBe(42)
  })

  it('semantic embed timeout degrades to a LABELED fts-only retry; count skipped (cutover fix)', async () => {
    let calls = 0
    const client = makeClient([
      {
        match: (url) => url.includes('/query'),
        handle: async (_url, init) => {
          calls++
          const req = JSON.parse(String(init?.body))
          if (req.semantic_search !== undefined) {
            // simulate AbortSignal.timeout: fetch rejects with a timeout error
            throw new Error('The operation timed out.')
          }
          return json({
            responses: [{
              hits: { total: 1, max_score: 0.5, hits: [{ _id: 'a', _score: 0.5, _index_scores: { full_text: 0.5 }, _source: { title: 'x' }, _sort: null }] },
              aggregations: null, took: 2, status: 200, error: null, table: 't',
            }],
          })
        },
      },
    ])
    const result = await client.query('t', { text: 'x', adapterOptions: { indexes: ['sem'] } })
    expect(result.hits).toHaveLength(1)
    expect(result.diagnostics?.strategy).toBe('fts')
    expect((result.diagnostics?.adapter as Record<string, unknown>)?.degraded).toBe('semantic-embed-timeout')
    expect(result.diagnostics?.budget).toBe('degraded')
    // attempt 1 (semantic, timed out) + fts retry — nothing else (the old
    // count twin is gone; rc.18 totals are corpus-true on every response)
    expect(calls).toBe(2)
  })

  it('non-timeout semantic failures are NOT silently degraded', async () => {
    const client = makeClient([
      { match: (url) => url.includes('/query'), handle: () => new Response('bad', { status: 400 }) },
    ])
    expect(client.query('t', { text: 'x', adapterOptions: { indexes: ['sem'] } })).rejects.toThrow(SearchRequestRejectedError)
  })

  it('multiQuery isolates per-table failures: a sick table contributes zero hits (cutover fix)', async () => {
    const client = makeClient([
      { match: (url) => url.includes('/tables/sick/query'), handle: () => new Response('boom', { status: 500 }) },
      {
        match: (url) => url.includes('/tables/healthy/query'),
        handle: () => json({
          responses: [{
            hits: { total: 1, max_score: 1, hits: [{ _id: 'h1', _score: 1, _index_scores: null, _source: {}, _sort: null }] },
            aggregations: null, took: 1, status: 200, error: null, table: 'healthy',
          }],
        }),
      },
    ])
    const results = await client.multiQuery([
      { table: 'sick', query: { text: 'x', strategy: 'fts' } },
      { table: 'healthy', query: { text: 'x', strategy: 'fts' } },
    ])
    expect(results).toHaveLength(2)
    expect(results[0].hits).toHaveLength(0)
    expect((results[0].diagnostics?.adapter as Record<string, unknown>)?.error).toContain('500')
    expect(results[1].hits.map((h) => h.key)).toEqual(['h1'])
  })

  it('FTS-only queries skip the companion count', async () => {
    let calls = 0
    const client = makeClient([
      {
        match: (url) => url.includes('/query'),
        handle: () => {
          calls++
          return json({ responses: [{ hits: { total: 3, hits: [], max_score: 0 }, aggregations: null, took: 1, status: 200, error: null, table: 't' }] })
        },
      },
    ])
    await client.query('t', { text: 'x', strategy: 'fts' })
    expect(calls).toBe(1)
  })
})

describe('query deadlines (rc.18 timeout_ms)', () => {
  it('propagates Query.deadlineMs to the wire as timeout_ms', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const client = makeClient([
      {
        match: (url) => url.includes('/query'),
        handle: (_url, init) => {
          bodies.push(JSON.parse(String(init?.body)))
          return json({ responses: [{ hits: { total: 0, hits: [], max_score: 0 }, aggregations: null, took: 1, status: 200, error: null, table: 't' }] })
        },
      },
    ])
    await client.query('t', { text: 'x', deadlineMs: 1500 })
    expect(bodies[0]!.timeout_ms).toBe(1500)
  })

  it('a server 504 (deadline expired) with semantic degrades to a labeled fts retry', async () => {
    const client = makeClient([
      {
        match: (url) => url.includes('/query'),
        handle: (_url, init) => {
          const req = JSON.parse(String(init?.body))
          if (req.semantic_search !== undefined) return new Response('deadline exceeded', { status: 504 })
          return json({
            responses: [{
              hits: { total: 1, max_score: 0.5, hits: [{ _id: 'a', _score: 0.5, _index_scores: { full_text: 0.5 }, _source: { title: 'x' }, _sort: null }] },
              aggregations: null, took: 2, status: 200, error: null, table: 't',
            }],
          })
        },
      },
    ])
    const result = await client.query('t', { text: 'x', deadlineMs: 2000, adapterOptions: { indexes: ['sem'] } })
    expect(result.hits).toHaveLength(1)
    expect(result.diagnostics?.budget).toBe('degraded')
  })

  it('multiQuery marks a table that missed its deadline entirely as budget: omitted', async () => {
    const client = makeClient([
      { match: (url) => url.includes('/tables/slow/query'), handle: () => new Response('deadline exceeded', { status: 504 }) },
      {
        match: (url) => url.includes('/tables/fast/query'),
        handle: () => json({ responses: [{ hits: { total: 1, hits: [{ _id: 'f', _score: 1, _index_scores: null, _source: {}, _sort: null }], max_score: 1 }, aggregations: null, took: 1, status: 200, error: null, table: 'fast' }] }),
      },
    ])
    // slow: FTS-only query (no semantic to degrade to) → 504 → omitted
    const results = await client.multiQuery([
      { table: 'slow', query: { text: 'x', deadlineMs: 500 } },
      { table: 'fast', query: { text: 'x', deadlineMs: 500 } },
    ])
    expect(results[0]!.hits).toHaveLength(0)
    expect(results[0]!.diagnostics?.budget).toBe('omitted')
    expect(results[1]!.hits).toHaveLength(1)
    expect(results[1]!.diagnostics?.budget).toBeUndefined()
  })
})

describe('tables', () => {
  it('health maps /indexes statuses to per-leg states; stats reads doc_count (never a query)', async () => {
    const entries = [
      { config: { name: 'full_text_index_v0', type: 'full_text' }, status: { index_type: 'full_text', rebuilding: false, total_indexed: 7, backfill_active: false, backfill_state: 'ready', doc_count: 7 } },
      { config: { name: 'sem', type: 'embeddings' }, status: { index_type: 'embeddings', rebuilding: true, total_indexed: 3, backfill_active: true, backfill_state: 'running', doc_count: 7 } },
    ]
    const client = makeClient([{ match: (url) => url.includes('/indexes'), handle: () => json(entries) }])
    const legs = await client.tables.health('t')
    expect(legs).toEqual([
      { leg: 'full_text_index_v0', state: 'ready', indexedCount: 7 },
      { leg: 'sem', state: 'building', indexedCount: 3 },
    ])
    expect((await client.tables.stats('t'))?.documents).toBe(7)
  })

  it('stats returns null for a missing table (404)', async () => {
    const client = makeClient([{ match: () => true, handle: () => new Response('no such table', { status: 404 }) }])
    expect(await client.tables.stats('missing')).toBeNull()
  })

  it('stats THROWS on non-404 rejections instead of reporting null (missing)', async () => {
    // A 400 (malformed leg, unprocessable read) once collapsed to null,
    // which the doctor reported as "Active Search index is missing" and
    // routed to a blue/green rebuild — the wrong repair entirely
    // (2026-07-21 field incident). Only the engine's own 404 means gone.
    const client = makeClient([{ match: () => true, handle: () => new Response('bad leg spec', { status: 400 }) }])
    expect(client.tables.stats('t')).rejects.toThrow(SearchRequestRejectedError)
  })
})

describe('documents', () => {
  it('batchRemove returns the engine-reported deleted count', async () => {
    const client = makeClient([
      { match: (url) => url.includes('/batch'), handle: () => json({ inserted: 0, deleted: 2, transformed: 0 }, 201) },
    ])
    expect(await client.documents.batchRemove('t', ['a', 'b', 'missing'])).toBe(2)
  })

  it('transform is read-modify-write; missing document is a no-op', async () => {
    const writes: unknown[] = []
    const client = makeClient([
      { match: (url) => url.includes('/documents/'), handle: () => json({ status: 'draft', n: 1 }) },
      {
        match: (url) => url.includes('/batch'),
        handle: (_url, init) => { writes.push(JSON.parse(String(init?.body))); return json({ inserted: 1, deleted: 0, transformed: 0 }, 201) },
      },
    ])
    await client.documents.transform('t', 'k', (doc) => ({ ...doc, status: 'done' }))
    expect(writes[0]).toEqual({ inserts: { k: { status: 'done', n: 1 } }, sync_level: 'full_index' })

    const gone = makeClient([{ match: (url) => url.includes('/documents/'), handle: () => new Response('nope', { status: 404 }) }])
    await gone.documents.transform('t', 'k', (doc) => doc) // must not throw
  })
})

describe('scan', () => {
  it('parses NDJSON lines, accepts _id/key/_key, skips keyless rows', async () => {
    const nd = [
      JSON.stringify({ _id: 'r18', title: 'zero' }),
      JSON.stringify({ key: 'a', title: 'one' }),
      JSON.stringify({ _key: 'b', title: 'two' }),
      JSON.stringify({ title: 'keyless' }),
      '',
    ].join('\n')
    const client = makeClient([
      { match: (url) => url.includes('/documents'), handle: () => new Response(nd, { status: 200 }) },
    ])
    const rows: Array<{ key: string; document: Record<string, unknown> }> = []
    for await (const row of client.scan('t', { fields: ['title'] })) rows.push(row)
    expect(rows).toEqual([
      { key: 'r18', document: { title: 'zero' } },
      { key: 'a', document: { title: 'one' } },
      { key: 'b', document: { title: 'two' } },
    ])
  })
})

describe('tables.create (0.2.0 two-phase provisioning)', () => {
  it('creates the table, then each embeddings leg via the per-index endpoint, in order', async () => {
    // Inline `indexes` at table-create are silently dead on 0.2.0 (accepted,
    // stored, enrichment never starts) — the legs MUST ride
    // POST /tables/{t}/indexes/{name}, after the table and before any write.
    const calls: Array<{ method: string; url: string; body: unknown }> = []
    const client = makeClient([
      {
        match: () => true,
        handle: (url, init) => {
          calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
          return json({}, 201)
        },
      },
    ])
    await client.tables.create('t', {
      fields: { title: { type: 'text' } },
      legs: [
        { name: 'full_text', capability: 'full-text', fields: ['title'] },
        { name: 'sem', capability: 'text-embedding', fields: ['title'] },
        { name: 'vis', capability: 'media-embedding', fields: [], mediaUrlField: 'media_url' },
      ],
    })
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'POST /db/v1/tables/t',
      'POST /db/v1/tables/t/indexes/sem',
      'POST /db/v1/tables/t/indexes/vis',
    ])
    // The table body carries no inline indexes; each leg body names itself.
    expect(calls[0].body).toEqual({ num_shards: 1 })
    expect((calls[1].body as { name: string; type: string }).name).toBe('sem')
    expect((calls[2].body as { name: string; type: string }).type).toBe('embeddings')
  })
})

describe('identity', () => {
  it('mappingFingerprint is stable and changes with embedder settings', () => {
    const a = new AntflySearchClient(DEFAULT_SETTINGS, { fetchImpl: fetch })
    const b = new AntflySearchClient(DEFAULT_SETTINGS, { fetchImpl: fetch })
    expect(a.mappingFingerprint()).toBe(b.mappingFingerprint())
    const c = new AntflySearchClient({
      ...DEFAULT_SETTINGS,
      embedders: { ...DEFAULT_SETTINGS.embedders, visual: { provider: 'antfly', model: 'other/model', dimension: 512 } },
    }, { fetchImpl: fetch })
    expect(c.mappingFingerprint()).not.toBe(a.mappingFingerprint())
  })
})

describe('multiQuery fan-out budget (2026-07-22)', () => {
  it('sequential (rerank) fan-out shares ONE wall-clock — total ≈ budget, not budget × tables', async () => {
    const { AntflySearchClient } = await import('../../packages/adapter-antfly/src/client')
    const { DEFAULT_SETTINGS } = await import('../../packages/adapter-antfly/src/defaults')
    // Every table query hangs until its own deadline: pre-fix, N tables
    // took N × deadline back-to-back (the 32-second /api/search spinner).
    const slowFetch = (async (_url: unknown, init?: { signal?: AbortSignal }) => {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 60_000)
        init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')) })
      })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const client = new AntflySearchClient({ ...DEFAULT_SETTINGS, url: 'http://127.0.0.1:9' }, { fetchImpl: slowFetch })

    const started = Date.now()
    const results = await client.multiQuery(
      Array.from({ length: 6 }, (_, i) => ({
        table: `t${i}`,
        query: { text: 'x', limit: 1, rerank: true, deadlineMs: 500 },
      })),
    )
    const took = Date.now() - started

    expect(results).toHaveLength(6)
    // Total ≈ one budget (+ grace), NOT 6 × 500ms = 3s+.
    expect(took).toBeLessThan(2_500)
    // Every table answered honestly (omitted/degraded), none silently.
    for (const r of results) {
      expect(r.diagnostics?.budget).toMatch(/omitted|degraded/)
    }
  })
})

describe('standalone rerank (#846)', () => {
  it('POSTs /ml/v1/rerank with {model, query, prompts} and returns scores in prompt order', async () => {
    let sent: unknown = null
    const client = makeClient([{
      match: (url) => url.includes('/ml/v1/rerank'),
      handle: (_url, init) => {
        sent = JSON.parse(String(init?.body))
        return json({ object: 'list', data: [
          { object: 'rerank.score', index: 0, score: 0.0002 },
          { object: 'rerank.score', index: 1, score: 0.996 },
        ] })
      },
    }])
    const scores = await client.rerank('sourdough hydration', ['vlan routing', 'sourdough schedule'])
    expect(scores).toEqual([0.0002, 0.996])
    expect(sent).toEqual({
      model: 'mixedbread-ai/mxbai-rerank-base-v1',
      query: 'sourdough hydration',
      prompts: ['vlan routing', 'sourdough schedule'],
    })
  })

  it('degrades to null on engine failure — never throws into the merge path', async () => {
    const client = makeClient([{
      match: (url) => url.includes('/ml/v1/rerank'),
      handle: () => json({ error: 'boom' }, 500),
    }])
    expect(await client.rerank('q', ['a', 'b'])).toBeNull()
  })

  it('returns null without a fetch when the reranker is disabled or unconfigured', async () => {
    const off = new AntflySearchClient(
      { ...DEFAULT_SETTINGS, search: { ...DEFAULT_SETTINGS.search, reranker: { ...DEFAULT_SETTINGS.search.reranker, enabled: false } } },
      { fetchImpl: scriptedFetch([]) }, // any fetch would throw 'unrouted'
    )
    expect(await off.rerank('q', ['a'])).toBeNull()
    expect(await makeClient([]).rerank('q', [])).toBeNull() // empty input → trivial null
  })
})

describe('#930 facet split on semantic queries', () => {
  const hit = (id: string) => ({ _id: id, _score: 1.2, _index_scores: { full_text: 3, assets_text: 0.6, assets_visual: 0.4 }, _source: { title: id } })
  const envelope = (hits: unknown[], aggregations: unknown = null) =>
    ({ responses: [{ hits: { total: { value: hits.length, relation: 'exact' }, hits, max_score: 1 }, aggregations, took: 1, status: 200, error: null, table: 't' }] })
  const hybridQuery = {
    text: 'pie',
    facets: ['asset_type'],
    limit: 20,
    adapterOptions: { indexes: ['assets_text', 'assets_visual'], searchableFields: ['description'] },
  }

  function capture() {
    const bodies: Array<Record<string, unknown>> = []
    return { bodies, record: (init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>) } }
  }

  it('sends the hits request WITHOUT aggregations and a match-all count companion, and merges the buckets', async () => {
    const { bodies, record } = capture()
    const client = makeClient([{
      match: (url, init) => url.includes('/query') && init?.method === 'POST',
      handle: (_url, init) => {
        record(init)
        const body = bodies[bodies.length - 1]!
        if (body.count === true) return json(envelope([], { asset_type: { buckets: [{ key: 'image', doc_count: 9 }] } }))
        return json(envelope([hit('a'), hit('b')]))
      },
    }])
    const result = await client.query('t', hybridQuery)

    expect(bodies).toHaveLength(2)
    const main = bodies.find((b) => b.count !== true)!
    const companion = bodies.find((b) => b.count === true)!
    expect(main.semantic_search).toBe('pie')
    expect(main.aggregations).toBeUndefined()
    expect(companion.semantic_search).toBeUndefined()
    expect(companion.full_text_search).toEqual({ match_all: {} })
    expect(companion.limit).toBe(0)
    expect(companion.aggregations).toEqual({ asset_type: { type: 'terms', field: 'asset_type', size: 50 } })

    expect(result.hits.map((h) => h.key)).toEqual(['a', 'b'])
    expect(result.hits[0]?.scoreBreakdown).toEqual({ full_text: 3, assets_text: 0.6, assets_visual: 0.4 })
    expect(result.facets).toEqual({ asset_type: [{ value: 'image', count: 9 }] })
    expect(result.diagnostics?.budget).toBeUndefined()
    expect(result.diagnostics?.adapter?.facets).toBe('companion-count')
  })

  it('a failing companion omits the facets with a label — hits keep their leg scores, never the scan fallback', async () => {
    const { bodies, record } = capture()
    const client = makeClient([{
      match: (url, init) => url.includes('/query') && init?.method === 'POST',
      handle: (_url, init) => {
        record(init)
        const body = bodies[bodies.length - 1]!
        if (body.count === true) return json({ status: 422, error: 'query_candidate_budget_exceeded', message: 'query candidate budget exceeded' }, 422)
        return json(envelope([hit('a')]))
      },
    }])
    const result = await client.query('t', hybridQuery)
    expect(result.hits.map((h) => h.key)).toEqual(['a'])
    expect(result.hits[0]?.score).toBe(1.2)
    expect(result.facets).toBeUndefined()
    expect(result.diagnostics?.budget).toBeUndefined()
    expect(result.diagnostics?.facets).toBe('omitted') // adapter-neutral — what the response contract propagates
    expect(result.diagnostics?.adapter?.facets).toBe('omitted')
    expect(String(result.diagnostics?.adapter?.facetsError)).toContain('422')
  })

  it('an fts-only query keeps its aggregations on the single request (no split)', async () => {
    const { bodies, record } = capture()
    const client = makeClient([{
      match: (url, init) => url.includes('/query') && init?.method === 'POST',
      handle: (_url, init) => { record(init); return json(envelope([hit('a')], { asset_type: { buckets: [{ key: 'image', doc_count: 1 }] } })) },
    }])
    const result = await client.query('t', { ...hybridQuery, strategy: 'fts' })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]?.aggregations).toBeDefined()
    expect(bodies[0]?.semantic_search).toBeUndefined()
    expect(result.facets).toEqual({ asset_type: [{ value: 'image', count: 1 }] })
  })
})
