import { describe, expect, it } from 'bun:test'
import { usageWindowScopeLabel } from '../../../plugins/health/lib/usage-window'

describe('usageWindowScopeLabel', () => {
  it('keeps the familiar labels for ordinary day-aligned windows', () => {
    expect(usageWindowScopeLabel('2026-07-14', '2026-07-15')).toBe('Today + yesterday')
    expect(usageWindowScopeLabel('2026-07-08', '2026-07-15')).toBe('8 calendar days')
  })

  it('does not claim two dates when a 24-hour DST window touches three', () => {
    expect(usageWindowScopeLabel('2026-03-07', '2026-03-09')).toBe('3 calendar days')
  })

  it('falls back to the exact evidence when the server returns an invalid range', () => {
    expect(usageWindowScopeLabel('unknown', '2026-07-15')).toBe('unknown through 2026-07-15')
  })
})
