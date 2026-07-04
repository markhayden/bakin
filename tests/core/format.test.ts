/**
 * Pure formatters in packages/core/src/format.ts. No I/O; the content-dir
 * mocks are present defensively per the repo's testing convention.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), 'bakin-test-format')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { formatDuration, formatDateTime } from '../../packages/core/src/format'

describe('formatDuration', () => {
  it('returns null for undefined', () => {
    expect(formatDuration(undefined)).toBeNull()
  })
  it('renders sub-second values in ms', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(850)).toBe('850ms')
    expect(formatDuration(999)).toBe('999ms')
  })
  it('renders sub-minute values in whole seconds (rounded)', () => {
    expect(formatDuration(1000)).toBe('1s')
    expect(formatDuration(1499)).toBe('1s')
    expect(formatDuration(1500)).toBe('2s')
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(59_000)).toBe('59s')
  })
  it('renders minute+second values', () => {
    expect(formatDuration(60_000)).toBe('1m 0s')
    expect(formatDuration(185_000)).toBe('3m 5s')
    expect(formatDuration(59 * 60_000 + 59_000)).toBe('59m 59s')
  })
  it('rolls hour-scale values up to hours+minutes', () => {
    expect(formatDuration(3_600_000)).toBe('1h 0m')
    expect(formatDuration(2 * 3_600_000 + 5 * 60_000)).toBe('2h 5m')
    expect(formatDuration(23 * 3_600_000 + 59 * 60_000)).toBe('23h 59m')
  })
  it('rolls day-scale values up to days+hours', () => {
    expect(formatDuration(24 * 3_600_000)).toBe('1d 0h')
    expect(formatDuration(3 * 24 * 3_600_000 + 2 * 3_600_000)).toBe('3d 2h')
  })
})

describe('formatDateTime', () => {
  it('returns the raw input for an unparseable timestamp', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date')
  })
  it('prefixes today with "Today" and a localized time', () => {
    // Locales separate time and meridiem with a narrow no-break space (\s covers it).
    const out = formatDateTime(new Date().toISOString())
    expect(out).toMatch(/^Today \d{1,2}:\d{2}\s?(AM|PM)$/)
  })
  it('prefixes yesterday with "Yesterday"', () => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    expect(formatDateTime(d.toISOString())).toMatch(/^Yesterday /)
  })
  it('omits the year for same-year past dates', () => {
    const now = new Date()
    const d = new Date(now.getFullYear(), 5, 15, 12, 0, 0)
    if (Math.round((Date.now() - d.getTime()) / 86_400_000) > 1) {
      expect(formatDateTime(d.toISOString())).not.toMatch(/\b\d{4}\b/)
    }
  })
  it('carries the year for prior-year dates', () => {
    // Local-time parse (no trailing Z) keeps the calendar date stable across timezones.
    const out = formatDateTime('2020-01-05T12:00:00')
    expect(out).toContain('Jan 5')
    expect(out).toContain('2020')
  })
})
