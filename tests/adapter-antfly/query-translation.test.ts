import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Query } from '@bakin/core/adapters/search'

// buildQueryRequest is a pure function (no client, no IO), but the isolation
// checker requires the content-dir resolvers be mocked in any test under this
// tree — harmless belt-and-suspenders so nothing can reach ~/.bakin/.
const testDir = join(tmpdir(), 'bakin-test-query-translation')
const paths = { root: testDir, db: join(testDir, 'bakin.db') }
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => paths }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => paths }))

import { buildQueryRequest } from '../../packages/adapter-antfly/src/query-translation'
import { DEFAULT_SETTINGS } from '../../packages/adapter-antfly/src/defaults'

// Pure wire-shape regressions for the Bakin → antfly v0.2 Query AST. No client,
// no IO — buildQueryRequest is a pure function, so no content-dir mocks needed.

const settings = DEFAULT_SETTINGS

describe('buildQueryRequest — full-text AST shape (bakin#456 item 1)', () => {
  it('scopes a single searchable field as a MatchQuery { match, field }', () => {
    const q: Query = { text: 'build feature', strategy: 'fts', adapterOptions: { searchableFields: ['title'] } }
    const req = buildQueryRequest('bakin_tasks', q, settings)
    expect(req.full_text_search).toEqual({ match: 'build feature', field: 'title' })
  })

  it('scopes multiple fields as a should DisjunctionQuery of per-field MatchQuery', () => {
    const q: Query = {
      text: 'build feature',
      strategy: 'fts',
      adapterOptions: { searchableFields: ['title', 'body'] },
    }
    const req = buildQueryRequest('bakin_tasks', q, settings)
    expect(req.full_text_search).toEqual({
      should: {
        disjuncts: [
          { match: 'build feature', field: 'title' },
          { match: 'build feature', field: 'body' },
        ],
      },
    })
  })

  it('falls back to the bare query-string shape when searchable fields are unknown', () => {
    const q: Query = { text: 'build feature', strategy: 'fts' }
    const req = buildQueryRequest('bakin_tasks', q, settings)
    expect(req.full_text_search).toEqual({ query: 'build feature' })
  })

  it('never emits the invalid { bool: { should: [{ match: { field, text } }] } } shape', () => {
    const q: Query = { text: 'x', strategy: 'fts', adapterOptions: { searchableFields: ['a', 'b'] } }
    const req = buildQueryRequest('bakin_tasks', q, settings)
    expect((req.full_text_search as Record<string, unknown>).bool).toBeUndefined()
  })

  it('maps q:* to explicit MatchAllQuery even when searchable fields are configured', () => {
    const q: Query = { text: '*', strategy: 'fts', adapterOptions: { searchableFields: ['title', 'body'] } }
    const req = buildQueryRequest('bakin_memory', q, settings)
    expect(req.full_text_search).toEqual({ match_all: {} })
  })

  it('maps blank filter-only queries to MatchAllQuery AND filter conjuncts in the AST', () => {
    const q: Query = {
      text: '',
      strategy: 'fts',
      filters: [{ field: 'tier', op: 'eq', value: 'turn' }],
    }
    const req = buildQueryRequest('bakin_memory', q, settings)
    // Filters must ride INSIDE full_text_search: the dedicated filter_query
    // field silently returns zero hits at rc.9 (live-verified upstream bug).
    expect(req.full_text_search).toEqual({
      must: {
        conjuncts: [
          { match_all: {} },
          { match_phrase: 'turn', field: 'tier' },
        ],
      },
    })
    expect(req.filter_query).toBeUndefined()
  })

  it('maps every filter op to its live-verified AST node', () => {
    const q: Query = {
      text: '',
      strategy: 'fts',
      filters: [
        { field: 'tier', op: 'in', value: ['audit', 'turn'] },
        { field: 'updated_at', op: 'gte', value: 1000 },
        { field: 'updated_at', op: 'lt', value: 2000 },
        { field: 'content', op: 'contains', value: 'beacon' },
        { field: 'agent', op: 'neq', value: 'system' },
        { field: 'count', op: 'eq', value: 5 },
      ],
    }
    const req = buildQueryRequest('bakin_memory', q, settings) as Record<string, unknown>
    expect(req.full_text_search).toEqual({
      must: {
        conjuncts: [
          { match_all: {} },
          { should: { disjuncts: [
            { match_phrase: 'audit', field: 'tier' },
            { match_phrase: 'turn', field: 'tier' },
          ] } },
          { min: 1000, inclusive_min: true, field: 'updated_at' },
          { max: 2000, inclusive_max: false, field: 'updated_at' },
          { match: 'beacon', field: 'content' },
          { min: 5, max: 5, inclusive_min: true, inclusive_max: true, field: 'count' },
        ],
      },
      must_not: {
        disjuncts: [{ match_phrase: 'system', field: 'agent' }],
      },
    })
  })

  it('marks limit-0 requests count-only and drops the reranker', () => {
    const q: Query = {
      text: '*',
      strategy: 'fts',
      limit: 0,
      filters: [{ field: 'tier', op: 'eq', value: 'audit' }],
      adapterOptions: { rerankField: 'content' },
    }
    const req = buildQueryRequest('bakin_memory', q, settings) as Record<string, unknown>
    // limit:0 returns total 0 + null buckets at rc.9; count:true returns the
    // real total and full-corpus buckets (live-verified).
    expect(req.count).toBe(true)
    expect(req.reranker).toBeUndefined()
  })

  it('maps blank facet-only queries to MatchAllQuery plus aggregations', () => {
    const q: Query = { text: '', strategy: 'fts', facets: ['agent'] }
    const req = buildQueryRequest('bakin_memory', q, settings)
    expect(req.full_text_search).toEqual({ match_all: {} })
    expect(req.aggregations).toEqual({ agent: { type: 'terms', field: 'agent', size: 50 } })
  })

  it('leaves a blank no-criteria query without a search leg', () => {
    const q: Query = { text: '', strategy: 'fts' }
    const req = buildQueryRequest('bakin_memory', q, settings)
    expect(req.full_text_search).toBeUndefined()
    expect(req.semantic_search).toBeUndefined()
  })
})

describe('buildQueryRequest — offset is full-text-only (v0.2 contract)', () => {
  it('attaches offset for a full-text-only (fts) query', () => {
    const q: Query = { text: 'x', strategy: 'fts', offset: 40 }
    expect(buildQueryRequest('bakin_tasks', q, settings).offset).toBe(40)
  })

  it('omits offset for a hybrid (rrf) query', () => {
    const q: Query = { text: 'x', strategy: 'hybrid', offset: 40 }
    expect(buildQueryRequest('bakin_tasks', q, settings).offset).toBeUndefined()
  })

  it('omits offset for a semantic-only (vector) query', () => {
    const q: Query = { text: 'x', strategy: 'vector', offset: 40 }
    expect(buildQueryRequest('bakin_tasks', q, settings).offset).toBeUndefined()
  })
})

describe('buildQueryRequest — per-strategy legs', () => {
  it('semantic-only omits the full-text leg entirely', () => {
    const q: Query = { text: 'x', strategy: 'vector' }
    const req = buildQueryRequest('bakin_tasks', q, settings)
    expect(req.full_text_search).toBeUndefined()
    expect(req.semantic_search).toBe('x')
    expect(req.indexes).toEqual(['embeddings'])
  })

  it('full-text-only omits semantic_search and indexes', () => {
    const q: Query = { text: 'x', strategy: 'fts' }
    const req = buildQueryRequest('bakin_tasks', q, settings)
    expect(req.semantic_search).toBeUndefined()
    expect(req.indexes).toBeUndefined()
  })
})
