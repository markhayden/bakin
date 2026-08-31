/**
 * Translation goldens for the antfly-main wire contract. Shapes mirror
 * live probes against antflydb/antfly @ 6538c0774
 * (tasks/evidence-search-rebuild.md — P0.2 verdict table).
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// Pure-function tests — the mocks exist to satisfy the blanket isolation
// rule (nothing in a test run may resolve the real ~/.bakin).
const testDir = join(tmpdir(), `bakin-test-translate-${Date.now()}-${randomUUID()}`)
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

import {
  buildQueryRequest,
  buildFilterQuery,
  buildTableProvisioning,
  buildBatchInserts,
  buildBatchDeletes,
  mapQueryResponse,
  mapIndexStatuses,
} from '../../packages/adapter-antfly/src/translate'
import { DEFAULT_SETTINGS } from '../../packages/adapter-antfly/src/defaults'
import type { WireQueryEnvelope, WireIndexStatusEntry } from '../../packages/adapter-antfly/src/wire'

const S = DEFAULT_SETTINGS

describe('buildQueryRequest', () => {
  it('hybrid query: field-scoped FTS + semantic legs + fusion weights', () => {
    const req = buildQueryRequest('t', {
      text: 'dark dashboard',
      limit: 20,
      adapterOptions: {
        searchableFields: ['title', 'description'],
        indexes: ['assets_text', 'assets_visual'],
        indexWeights: { assets_text: 0.5, assets_visual: 2 },
      },
    }, S)
    expect(req).toEqual({
      table: 't',
      limit: 20,
      full_text_search: {
        should: { disjuncts: [
          { match: 'dark dashboard', field: 'title' },
          { match: 'dark dashboard', field: 'description' },
        ] },
      },
      semantic_search: 'dark dashboard',
      indexes: ['assets_text', 'assets_visual'],
      // rsf is the measured default (search-tuning.md)
      merge_config: { strategy: 'rsf', weights: { assets_text: 0.5, assets_visual: 2 } },
    })
  })

  it('filters KEEP the semantic leg — filter_query constrains both lanes on 0.2.0', () => {
    // The rc.17-era FTS-only forcing is gone: the no-leak property of
    // filter_query on semantic/hybrid lanes is live-probed (evidence file)
    // and guarded by workaround-regressions.
    const req = buildQueryRequest('t', {
      text: 'dark dashboard',
      filters: [{ field: 'agent', op: 'eq', value: 'pixel' }],
      adapterOptions: { searchableFields: ['title'], indexes: ['assets_text'] },
    }, S)
    expect(req.semantic_search).toBe('dark dashboard')
    expect(req.full_text_search).toEqual({ match: 'dark dashboard', field: 'title' })
    expect(req.filter_query).toEqual({ match_phrase: 'pixel', field: 'agent' })
  })

  it('filters ride filter_query; the full_text_search node stays clean', () => {
    const req = buildQueryRequest('t', {
      text: 'cats',
      strategy: 'fts',
      filters: [
        { field: 'kind', op: 'eq', value: 'note' },
        { field: 'n', op: 'gte', value: 3 },
        { field: 'agent', op: 'neq', value: 'system' },
      ],
      adapterOptions: { searchableFields: ['title'] },
    }, S)
    expect(req.full_text_search).toEqual({ match: 'cats', field: 'title' })
    expect(req.filter_query).toEqual({
      must: { conjuncts: [
        { match_phrase: 'note', field: 'kind' },
        { min: 3, inclusive_min: true, field: 'n' },
      ] },
      must_not: { disjuncts: [{ match_phrase: 'system', field: 'agent' }] },
    })
  })

  it('match-all list flow: bare filters/facets become match_all + filter_query, full-text-only', () => {
    const req = buildQueryRequest('t', {
      text: '',
      filters: [{ field: 'kind', op: 'eq', value: 'note' }],
      facets: ['kind'],
      limit: 10,
    }, S)
    expect(req.full_text_search).toEqual({ match_all: {} })
    expect(req.filter_query).toEqual({ match_phrase: 'note', field: 'kind' })
    expect(req.semantic_search).toBeUndefined()
    expect(req.aggregations).toEqual({ kind: { type: 'terms', field: 'kind', size: 50 } })
  })

  it('offset only attaches to FTS-only queries (semantic+offset hard-400s)', () => {
    const fts = buildQueryRequest('t', { text: 'x', strategy: 'fts', offset: 10 }, S)
    expect(fts.offset).toBe(10)
    const hybrid = buildQueryRequest('t', { text: 'x', offset: 10, adapterOptions: { indexes: ['sem'] } }, S)
    expect(hybrid.semantic_search).toBe('x')
    expect(hybrid.offset).toBeUndefined()
  })

  it('no embedding-leg names → no semantic leg (tables without vector indexes 400 otherwise)', () => {
    const req = buildQueryRequest('t', { text: 'x' }, S)
    expect(req.semantic_search).toBeUndefined()
    expect(req.merge_config).toBeUndefined()
    expect(req.full_text_search).toEqual({ query: 'x' })
  })

  it('limit 0 → count-only, reranker stripped', () => {
    const req = buildQueryRequest('t', { text: '*', limit: 0, rerank: true }, S)
    expect(req.count).toBe(true)
    expect(req.reranker).toBeUndefined()
  })

  it('never emits order_by (unsupported on the Zig engine)', () => {
    const req = buildQueryRequest('t', { text: 'x', sort: { field: 'n', direction: 'desc' } }, S)
    expect('order_by' in req).toBe(false)
  })

})

describe('buildFilterQuery', () => {
  it('single equality collapses to a bare node', () => {
    expect(buildFilterQuery([{ field: 'k', op: 'eq', value: 'v' }])).toEqual({ match_phrase: 'v', field: 'k' })
  })
  it('in-filter becomes a disjunction', () => {
    expect(buildFilterQuery([{ field: 'k', op: 'in', value: ['a', 'b'] }])).toEqual({
      should: { disjuncts: [
        { match_phrase: 'a', field: 'k' },
        { match_phrase: 'b', field: 'k' },
      ] },
    })
  })
  it('numeric equality uses a closed range', () => {
    expect(buildFilterQuery([{ field: 'n', op: 'eq', value: 5 }])).toEqual({
      min: 5, max: 5, inclusive_min: true, inclusive_max: true, field: 'n',
    })
  })
  it('exclusion-only filters get a match_all base — a pure-negation filter_query matches NOTHING on the engine', () => {
    expect(buildFilterQuery([{ field: 'agent', op: 'neq', value: 'system' }])).toEqual({
      must: { conjuncts: [{ match_all: {} }] },
      must_not: { disjuncts: [{ match_phrase: 'system', field: 'agent' }] },
    })
  })
})

describe('mapQueryResponse (responses[] envelope, _id keys, neutral leg scores)', () => {
  it('normalizes rc.18 object totals to numbers (corpus-true {value, relation})', () => {
    const envelope: WireQueryEnvelope = {
      responses: [{
        hits: { total: { value: 42, relation: 'exact' }, max_score: 0, hits: [] },
        aggregations: null, took: 1, status: 200, error: null, table: 't',
      }],
    }
    expect(mapQueryResponse(envelope, 't').total).toBe(42)
  })


  it('unwraps the envelope and passes _index_scores through verbatim', () => {
    const envelope: WireQueryEnvelope = {
      responses: [{
        hits: {
          total: 4,
          max_score: 0.7,
          hits: [
            { _id: 'h1', _score: 0.0486, _index_scores: { full_text: 0.7549, sem: -0.194 }, _source: { title: 'a' }, _sort: null },
            { _id: 'h4', _score: 0.0327, _index_scores: { sem: -0.169 }, _source: { title: 'b' }, _sort: null },
          ],
        },
        aggregations: { kind: { buckets: [{ key: 'note', doc_count: 2 }] } },
        took: 3,
        status: 200,
        error: null,
        table: 't',
      }],
    }
    const result = mapQueryResponse(envelope, 't')
    expect(result.hits).toHaveLength(2)
    expect(result.hits[0]).toEqual({
      key: 'h1',
      document: { title: 'a' },
      score: 0.0486,
      scoreBreakdown: { full_text: 0.7549, sem: -0.194 },
    })
    expect(result.total).toBe(4)
    expect(result.facets).toEqual({ kind: [{ value: 'note', count: 2 }] })
  })

  it('empty/missing envelope maps to an empty result', () => {
    expect(mapQueryResponse(null, 't').hits).toHaveLength(0)
  })
})

describe('buildBatch*', () => {
  it('inserts use sync_level full_index (aknn was removed upstream)', () => {
    const req = buildBatchInserts([{ key: 'k1', doc: { a: 1 } }])
    expect(req).toEqual({ inserts: { k1: { a: 1 } }, sync_level: 'full_index' })
  })
  it('sync:false omits sync_level — async backfill indexing (cutover fix)', () => {
    const req = buildBatchInserts([{ key: 'k1', doc: { a: 1 } }], { sync: false })
    expect(req).toEqual({ inserts: { k1: { a: 1 } } })
    expect('sync_level' in req).toBe(false)
  })

  it('deletes ride the same batch shape', () => {
    expect(buildBatchDeletes(['k1', 'k2'])).toEqual({ deletes: ['k1', 'k2'], sync_level: 'full_index' })
  })
})

describe('buildTableProvisioning (capability legs)', () => {
  it('full-text legs are omitted (server-managed); embedding legs map to indexes', () => {
    const plan = buildTableProvisioning({
      fields: { title: { type: 'text' } },
      legs: [
        { name: 'full_text', capability: 'full-text', fields: ['title', 'caption'] },
        { name: 'assets_text', capability: 'text-embedding', fields: ['title', 'caption'], chunker: { enabled: true } },
        { name: 'assets_visual', capability: 'media-embedding', fields: [], mediaUrlField: 'media_url' },
      ],
    }, S)
    // The table body carries NO inline indexes (0.2.0 silently ignores
    // them); legs ride the plan for per-index endpoint creation.
    expect(plan.table).toEqual({ num_shards: 1 })
    expect(plan.indexes.map((i) => i.name)).toEqual(['assets_text', 'assets_visual'])
    expect(plan.indexes[0]).toEqual({
      name: 'assets_text',
      type: 'embeddings',
      template: '{{title}} {{caption}}',
      dimension: 384,
      embedder: { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5' },
      chunker: { provider: 'antfly', model: 'fixed', text: { target_tokens: 200, overlap_tokens: 25 } },
    })
    expect(plan.indexes[1]).toEqual({
      name: 'assets_visual',
      type: 'embeddings',
      template: '{{#if media_url}}{{remoteMedia url=media_url}}{{/if}}',
      dimension: 512,
      embedder: { provider: 'antfly', model: 'antflydb/clipclap' },
    })
  })

  it('a DISABLED embedder produces NO leg — keyword-only degrade, never a dimension-0 spec', () => {
    // A disabled visual embedder once flowed through as dimension: 0, which
    // the engine 500s on EVERY create — bricking every media-capable table
    // on the box (2026-07-21 field incident).
    const disabledVisual = {
      ...S,
      embedders: {
        ...S.embedders,
        visual: { provider: 'disabled', model: '', dimension: 0 },
      },
    }
    const plan = buildTableProvisioning({
      fields: { title: { type: 'text' } },
      legs: [
        { name: 'assets_text', capability: 'text-embedding', fields: ['title'] },
        { name: 'assets_visual', capability: 'media-embedding', fields: [], mediaUrlField: 'media_url' },
      ],
    }, disabledVisual)
    expect(plan.indexes.map((i) => i.name)).toEqual(['assets_text'])
  })

  it('a zero-dimension embedder is treated as unusable even with a live provider', () => {
    const zeroDim = {
      ...S,
      embedders: {
        ...S.embedders,
        default: { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5', dimension: 0 },
      },
    }
    const plan = buildTableProvisioning({
      fields: {},
      legs: [{ name: 'sem', capability: 'text-embedding', fields: ['title'] }],
    }, zeroDim)
    expect(plan.indexes).toEqual([])
  })

  it('legacy indexes[] declarations still translate during the transition', () => {
    const plan = buildTableProvisioning({
      fields: {},
      indexes: [
        { name: 'sem', fields: ['title'], kind: 'vector' },
        { name: 'ft', fields: ['title'], kind: 'text' },
      ],
    }, S)
    expect(plan.indexes.map((i) => i.name)).toEqual(['sem'])
  })
})

describe('mapIndexStatuses', () => {
  it('maps engine status to per-leg health states', () => {
    const entries: WireIndexStatusEntry[] = [
      { config: { name: 'full_text_index_v0', type: 'full_text' }, status: { index_type: 'full_text', rebuilding: false, total_indexed: 5, backfill_active: false, backfill_state: 'ready', doc_count: 5 } },
      { config: { name: 'sem', type: 'embeddings' }, status: { index_type: 'embeddings', rebuilding: true, total_indexed: 2, backfill_active: true, backfill_state: 'running', doc_count: 5 } },
      { config: { name: 'vis', type: 'embeddings' }, status: { index_type: 'embeddings', rebuilding: false, total_indexed: 0, backfill_active: false, backfill_state: 'failed', doc_count: 5, last_error: 'ModelNotFound' } },
    ]
    expect(mapIndexStatuses(entries)).toEqual([
      { leg: 'full_text_index_v0', state: 'ready', indexedCount: 5 },
      { leg: 'sem', state: 'building', indexedCount: 2 },
      { leg: 'vis', state: 'error', indexedCount: 0, error: 'ModelNotFound' },
    ])
  })

  // rc.18 WORKAROUND — a full_text leg (no enrichment_runtime) on an empty
  // or fully caught-up table reports rebuilding/backfill_active FOREVER.
  // Observed live 2026-07-11: every empty green parked because its FTS leg
  // never went ready (bakin#spec search-trust-and-speed, GATE B). Idle
  // detection for runtime-less legs: caught up (indexed >= docs) with the
  // flags still up ⇒ ready.
  it('treats a caught-up runtime-less (full_text) leg as ready despite stuck flags', () => {
    const entries: WireIndexStatusEntry[] = [
      // empty table — the parked-green case
      { config: { name: 'full_text_index_v0', type: 'full_text' }, status: { index_type: 'full_text', rebuilding: true, total_indexed: 0, backfill_active: true, backfill_state: 'running', doc_count: 0 } },
      // caught up with docs — the stuck-flags case
      { config: { name: 'ft2', type: 'full_text' }, status: { index_type: 'full_text', rebuilding: true, total_indexed: 60, backfill_active: true, backfill_state: 'running', doc_count: 60 } },
      // genuinely mid-backfill — must stay building
      { config: { name: 'ft3', type: 'full_text' }, status: { index_type: 'full_text', rebuilding: true, total_indexed: 10, backfill_active: true, backfill_state: 'running', doc_count: 60 } },
    ]
    expect(mapIndexStatuses(entries)).toEqual([
      { leg: 'full_text_index_v0', state: 'ready', indexedCount: 0 },
      { leg: 'ft2', state: 'ready', indexedCount: 60 },
      { leg: 'ft3', state: 'building', indexedCount: 10 },
    ])
  })

  it('does not apply runtime-less idle detection to embeddings legs with a runtime', () => {
    const entries: WireIndexStatusEntry[] = [
      // embeddings leg with pending work — building even though counts match
      { config: { name: 'sem', type: 'embeddings' }, status: { index_type: 'embeddings', rebuilding: true, total_indexed: 5, backfill_active: true, backfill_state: 'running', doc_count: 5, enrichment_runtime: { pending_sequence_count: 3, retrying: false, active_embed_batch_items: 0 } } },
    ]
    expect(mapIndexStatuses(entries)).toEqual([
      { leg: 'sem', state: 'building', indexedCount: 5, pendingCount: 3 },
    ])
  })
})
