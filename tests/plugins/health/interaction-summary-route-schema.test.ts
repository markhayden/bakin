import { describe, expect, it } from 'bun:test'
import {
  interactionSummaryResponseSchema,
  isInteractionSummaryResponse,
  type InteractionSummaryResponse,
} from '../../../plugins/health/lib/interaction-summary-route-schema'

function summary(): InteractionSummaryResponse {
  const observedAt = '2026-07-15T12:00:00.000Z'
  return {
    window: '1h',
    coverage: { startsAt: '2026-07-15T11:00:00.000Z', hasFullWindow: true, reason: 'full_window' },
    totals: { count: 3, errors: 1, unverified: 0, foreground: 2, background: 1 },
    categories: [
      { key: 'tools', count: 1, errors: 0 },
      { key: 'api', count: 1, errors: 1 },
      { key: 'agents', count: 1, errors: 0 },
    ],
    topDestinations: [
      { category: 'api', name: '/api/tasks', count: 1, errors: 1, medianDurationMs: 12 },
    ],
    timeBuckets: [{ start: observedAt, count: 3, failureCount: 1, failureRate: 1 / 3 }],
  }
}

describe('interactionSummaryResponseSchema', () => {
  it('accepts a reconciled Overview interaction summary for the requested window', () => {
    const value = summary()
    expect(interactionSummaryResponseSchema.safeParse(value).success).toBe(true)
    expect(isInteractionSummaryResponse(value, '1h')).toBe(true)
    expect(isInteractionSummaryResponse(value, '24h')).toBe(false)
  })

  it('rejects source and time-bucket totals that disagree with the headline', () => {
    const sourceMismatch = summary()
    sourceMismatch.categories[0]!.count = 2
    const bucketMismatch = summary()
    bucketMismatch.timeBuckets[0]!.failureCount = 0
    bucketMismatch.timeBuckets[0]!.failureRate = 0

    expect(interactionSummaryResponseSchema.safeParse(sourceMismatch).success).toBe(false)
    expect(interactionSummaryResponseSchema.safeParse(bucketMismatch).success).toBe(false)
  })
})
