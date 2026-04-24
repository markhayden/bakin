import { describe, expect, it, mock } from 'bun:test'

// Mandatory mocks per CLAUDE.md test isolation rules — even though this is a
// pure-function test that never touches the filesystem, we keep the mocks in
// place so that an accidental import chain reaching content-dir/logger/watcher
// can never resolve to the real ~/.bakin or chokidar.
mock.module('@/core/content-dir', () => ({
  getContentDir: () => '/tmp/test-reorder',
  getBakinPaths: () => ({}),
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))
mock.module('@/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
}))

import { reorderBySearchResults, type SearchResult } from '@/hooks/use-search'

interface Item {
  id: string
  name: string
}

function mkResult(id: string, score: number): SearchResult {
  return { id, table: 'bakin_test', score, fields: {} }
}

describe('reorderBySearchResults', () => {
  it('returns input array unchanged when search results are empty', () => {
    const items: Item[] = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ]
    const out = reorderBySearchResults(items, [])
    expect(out).toEqual(items)
    // Same reference is fine — current impl returns the same array.
    expect(out).toBe(items)
  })

  it('partial match — scored items move to front in score order, unscored keep original order', () => {
    const items: Item[] = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
      { id: 'd', name: 'D' },
    ]
    const results = [mkResult('c', 0.9), mkResult('a', 0.5)]

    const out = reorderBySearchResults(items, results)

    expect(out.map((i) => i.id)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('full match — output sorted by score descending', () => {
    const items: Item[] = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ]
    const results = [
      mkResult('a', 0.2),
      mkResult('b', 0.8),
      mkResult('c', 0.5),
    ]

    const out = reorderBySearchResults(items, results)

    expect(out.map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })

  it('ties — Array.prototype.sort in V8 is stable, so tied items preserve original input order', () => {
    const items: Item[] = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ]
    const results = [
      mkResult('a', 0.5),
      mkResult('b', 0.5),
      mkResult('c', 0.5),
    ]

    const out = reorderBySearchResults(items, results)

    // V8 sort is stable since Node 12 — verify documented behavior.
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('preserves generic type — no any leakage', () => {
    interface MyType {
      id: string
      title: string
      count: number
    }

    const items: MyType[] = [
      { id: 'x', title: 'X', count: 1 },
      { id: 'y', title: 'Y', count: 2 },
    ]
    const results = [mkResult('y', 0.9)]

    const out = reorderBySearchResults<MyType>(items, results)

    // TypeScript would flag this at compile time if generic was lost, but
    // verify shape at runtime too.
    expect(out[0].title).toBe('Y')
    expect(out[0].count).toBe(2)
    expect(out[1].title).toBe('X')
    expect(out[1].count).toBe(1)
  })

  it('handles search results referencing ids that are not in the input list', () => {
    const items: Item[] = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]
    const results = [
      mkResult('zzz', 0.99), // not in items
      mkResult('b', 0.5),
    ]

    const out = reorderBySearchResults(items, results)

    expect(out.map((i) => i.id)).toEqual(['b', 'a'])
  })
})
