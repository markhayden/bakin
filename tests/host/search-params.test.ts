/**
 * Plain-string search params (routing overhaul PR3, task 3.1).
 *
 * The router must treat every query value as an opaque string: TanStack's
 * default JSON serializer turned "123"/"true" into numbers/booleans on
 * parse and JSON-quoted scalars on stringify (debug=%221%22), which the
 * old SDK shim countered with its own JSON.parse — coercing ids that look
 * numeric. These tests pin the whole path: host serializers round-trip
 * strings exactly, and toNavigationOptions passes values through raw.
 */
import { describe, test, expect, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'

// Pure functions — resolvers mocked per the repo-wide isolation rule.
const testDir = join(tmpdir(), `bakin-test-search-params-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
}))

import { parseSearchPlain, stringifySearchPlain } from '../../packages/host/src/lib/search-params'
import { toNavigationOptions } from '../../packages/sdk/src/hooks/router'

describe('parseSearchPlain', () => {
  test('every value stays a string — no JSON coercion', () => {
    const parsed = parseSearchPlain('?id=123&flag=true&list=a,b&text=hello')
    expect(parsed).toEqual({ id: '123', flag: 'true', list: 'a,b', text: 'hello' })
  })

  test('decodes URL-encoded values and handles empty search', () => {
    expect(parseSearchPlain('?q=a%20b%26c')).toEqual({ q: 'a b&c' })
    expect(parseSearchPlain('')).toEqual({})
    expect(parseSearchPlain('?')).toEqual({})
  })

  test('duplicate keys: last one wins (the app never emits duplicates)', () => {
    expect(parseSearchPlain('?k=1&k=2')).toEqual({ k: '2' })
  })
})

describe('stringifySearchPlain', () => {
  test('never JSON-quotes scalars', () => {
    const qs = stringifySearchPlain({ debug: 'true', page: '1' })
    expect(qs).toBe('?debug=true&page=1')
    expect(qs).not.toContain('%22')
  })

  test('skips null/undefined, keeps empty string, stringifies leftovers', () => {
    expect(stringifySearchPlain({ a: undefined, b: null, c: '', d: 5 })).toBe('?c=&d=5')
  })

  test('empty object produces an empty string (no bare "?")', () => {
    expect(stringifySearchPlain({})).toBe('')
  })

  test('round-trip is exact for string values', () => {
    const input = { id: '123', flag: 'true', csv: 'a,b', enc: 'x y&z' }
    expect(parseSearchPlain(stringifySearchPlain(input))).toEqual(input)
  })
})

describe('toNavigationOptions (SDK shim)', () => {
  test('query values pass through as raw strings — "123" stays "123"', () => {
    const opts = toNavigationOptions('/tasks?taskId=123&view=kanban')
    expect(opts.to).toBe('/tasks')
    expect(opts.search).toEqual({ taskId: '123', view: 'kanban' })
  })

  test('"true" and JSON-looking values stay strings', () => {
    const opts = toNavigationOptions('/x?debug=true&obj={"a":1}')
    expect(opts.search.debug).toBe('true')
    expect(opts.search.obj).toBe('{"a":1}')
  })

  test('hash and empty query are preserved', () => {
    expect(toNavigationOptions('/docs#section')).toEqual({ to: '/docs', search: {}, hash: 'section' })
    expect(toNavigationOptions('/docs?a=1#s')).toEqual({ to: '/docs', search: { a: '1' }, hash: 's' })
  })
})
