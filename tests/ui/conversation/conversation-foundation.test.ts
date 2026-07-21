import { describe, expect, it } from 'bun:test'

import {
  dayKey,
  formatAbsoluteTime,
  formatDayLabel,
  formatRelativeTime,
} from '@makinbakin/sdk/conversation'

describe('conversation time utilities', () => {
  const now = Date.parse('2026-07-20T12:00:00.000Z')

  it('uses compact stable thresholds and clamps future timestamps to now', () => {
    expect(formatRelativeTime('2026-07-20T12:01:00.000Z', now)).toBe('now')
    expect(formatRelativeTime('2026-07-20T11:59:01.000Z', now)).toBe('now')
    expect(formatRelativeTime('2026-07-20T11:59:00.000Z', now)).toBe('1m')
    expect(formatRelativeTime('2026-07-20T10:00:00.000Z', now)).toBe('2h')
    expect(formatRelativeTime('2026-07-17T12:00:00.000Z', now)).toBe('3d')
  })

  it('returns empty labels for invalid timestamps', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('')
    expect(formatAbsoluteTime('not-a-date')).toBe('')
    expect(formatDayLabel('not-a-date')).toBe('')
    expect(dayKey('not-a-date')).toBe('')
    expect(dayKey(undefined)).toBe('')
  })

  it('uses a local calendar key for day-separator comparison', () => {
    expect(dayKey('2026-07-20T12:00:00')).toBe('2026-6-20')
    expect(formatAbsoluteTime('2026-07-20T12:00:00')).not.toBe('')
    expect(formatDayLabel('2026-07-20T12:00:00')).not.toBe('')
  })
})
