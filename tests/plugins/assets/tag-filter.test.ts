/**
 * Pure unit tests for the client-side tag-filter helpers (no app modules, no
 * filesystem — same exception class as the constants tests).
 */
import { describe, it, expect } from 'bun:test'
import { UNTAGGED, matchesTagFilter } from '../../../plugins/assets/components/versioned/tag-filter'

describe('matchesTagFilter', () => {
  it('matches everything when the filter is empty', () => {
    expect(matchesTagFilter([], [])).toBe(true)
    expect(matchesTagFilter(['a'], [])).toBe(true)
  })

  it('matches any-of across multiple selected tags', () => {
    expect(matchesTagFilter(['a', 'b'], ['b', 'c'])).toBe(true)
    expect(matchesTagFilter(['a'], ['b', 'c'])).toBe(false)
  })

  it('UNTAGGED matches only tagless assets', () => {
    expect(matchesTagFilter([], [UNTAGGED])).toBe(true)
    expect(matchesTagFilter(['a'], [UNTAGGED])).toBe(false)
  })

  it('UNTAGGED composes any-of with real tags', () => {
    expect(matchesTagFilter([], [UNTAGGED, 'x'])).toBe(true)
    expect(matchesTagFilter(['x'], [UNTAGGED, 'x'])).toBe(true)
    expect(matchesTagFilter(['y'], [UNTAGGED, 'x'])).toBe(false)
  })

  it('never treats the sentinel as a literal tag', () => {
    // An asset can't legitimately carry the sentinel (normalization would
    // keep it, but nothing creates it); a tagless filter match must come
    // from emptiness, not string equality.
    expect(matchesTagFilter([UNTAGGED], ['some-tag'])).toBe(false)
  })
})
