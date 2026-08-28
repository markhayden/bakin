/**
 * `formatAge` precision contract.
 *
 * Default is minute granularity. `precise` resolves below a minute, which is
 * what live-status surfaces (heartbeats, the activity feed) need — those two
 * each carried their own near-identical copy until this option existed, and
 * the copies disagreed about the sub-ten-second case.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// format.ts imports nothing and does no I/O; these are present defensively,
// matching the sibling format.test.ts and the repo's testing convention.
const testDir = join(tmpdir(), 'bakin-test-format-age')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { formatAge } from '../../packages/core/src/format'

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

describe('formatAge default (minute granularity)', () => {
  it('flattens anything under a minute to "just now"', () => {
    expect(formatAge(ago(0))).toBe('just now')
    expect(formatAge(ago(42_000))).toBe('just now')
    expect(formatAge(ago(59_000))).toBe('just now')
  })

  it('steps through minutes, hours, then days', () => {
    expect(formatAge(ago(90_000))).toBe('1m ago')
    expect(formatAge(ago(3_600_000))).toBe('1h ago')
    expect(formatAge(ago(90_000_000))).toBe('1d ago')
  })
})

describe('formatAge precise', () => {
  it('resolves seconds, which the default erases', () => {
    expect(formatAge(ago(42_000), { precise: true })).toBe('42s ago')
    // The same input under the default is indistinguishable from brand new.
    expect(formatAge(ago(42_000))).toBe('just now')
  })

  it('still says "just now" under ten seconds so a live feed does not flicker', () => {
    expect(formatAge(ago(0), { precise: true })).toBe('just now')
    expect(formatAge(ago(9_000), { precise: true })).toBe('just now')
    expect(formatAge(ago(10_000), { precise: true })).toBe('10s ago')
  })

  it('hands off to the shared minute/hour/day ladder above a minute', () => {
    expect(formatAge(ago(90_000), { precise: true })).toBe('1m ago')
    expect(formatAge(ago(3_600_000), { precise: true })).toBe('1h ago')
  })

  it('reads a future timestamp as now rather than a negative age', () => {
    const future = new Date(Date.now() + 30_000).toISOString()
    expect(formatAge(future, { precise: true })).toBe('just now')
    expect(formatAge(future)).toBe('just now')
  })

  it('never throws on an unparseable timestamp', () => {
    expect(formatAge('not-a-date', { precise: true })).toBe('just now')
  })
})
