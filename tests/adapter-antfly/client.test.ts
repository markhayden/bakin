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
  it('unwraps the responses[] envelope and maps _id/_index_scores', async () => {
    const client = makeClient([
      {
        match: (url, init) => url.includes('/query') && init?.method === 'POST',
        handle: (_url, init) => {
          const req = JSON.parse(String(init?.body))
          if (req.count) {
            return json({ responses: [{ hits: { total: 42, hits: [], max_score: 0 }, aggregations: null, took: 1, status: 200, error: null, table: 't' }] })
          }
          return json({
            responses: [{
              hits: {
                total: 2,
                max_score: 0.9,
                hits: [{ _id: 'a', _score: 0.9, _index_scores: { full_text: 0.7, sem: -0.2 }, _source: { title: 'x' }, _sort: null }],
              },
              aggregations: null, took: 2, status: 200, error: null, table: 't',
            }],
          })
        },
      },
    ])
    // semantic query → companion count fires → true total 42
    const result = await client.query('t', { text: 'x', adapterOptions: { indexes: ['sem'] } })
    expect(result.hits[0].key).toBe('a')
    expect(result.hits[0].scoreBreakdown).toEqual({ full_text: 0.7, sem: -0.2 })
    expect(result.total).toBe(42)
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
    expect((await client.tables.getHealth('t'))?.status).toBe('warn')
  })

  it('stats returns null for a missing table (404)', async () => {
    const client = makeClient([{ match: () => true, handle: () => new Response('no such table', { status: 404 }) }])
    expect(await client.tables.stats('missing')).toBeNull()
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
  it('parses NDJSON lines, accepts key/_key, skips keyless rows', async () => {
    const nd = [
      JSON.stringify({ key: 'a', title: 'one' }),
      JSON.stringify({ _key: 'b', title: 'two' }),
      JSON.stringify({ title: 'keyless' }),
      '',
    ].join('\n')
    const client = makeClient([
      { match: (url) => url.includes('/lookup'), handle: () => new Response(nd, { status: 200 }) },
    ])
    const rows: Array<{ key: string; document: Record<string, unknown> }> = []
    for await (const row of client.scan('t', { fields: ['title'] })) rows.push(row)
    expect(rows).toEqual([
      { key: 'a', document: { title: 'one' } },
      { key: 'b', document: { title: 'two' } },
    ])
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
