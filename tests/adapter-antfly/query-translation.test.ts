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
