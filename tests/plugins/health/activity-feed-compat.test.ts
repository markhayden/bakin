import { describe, expect, it } from 'bun:test'
import { normalizeActivityFeed } from '../../../plugins/health/lib/activity-feed-compat'
import type { UsageFeedData } from '../../../plugins/health/types'

function dashboardFeed(topByName: Array<Record<string, unknown>>): UsageFeedData {
  return {
    window: '1h',
    coverage: {
      startsAt: '2026-07-14T12:00:00.000Z',
      hasFullWindow: true,
      reason: 'full_window',
    },
    totals: { count: 1, errors: 0, errorRate: 0 },
    outcomes: { failed: 0, unverified: 0, canceled: 0, succeeded: 1 },
    byKind: [
      { kind: 'mcp', total: 1, failures: 0 },
      { kind: 'rest', total: 0, failures: 0 },
      { kind: 'agent', total: 0, failures: 0 },
    ],
    failureGroups: [],
    failureGroupPage: { total: 0, offset: 0, limit: 25, hasMore: false },
    topByName: topByName as unknown as UsageFeedData['topByName'],
    byAgent: [],
    recent: [],
    recentFailures: [],
    recentUnverified: [],
    timeBuckets: [],
  }
}

describe('normalizeActivityFeed top destinations', () => {
  const destination = {
    name: 'shared.destination',
    count: 1,
    errors: 0,
    medianDurationMs: 12,
  }

  it('accepts both legacy rows without kind and current rows with a valid kind', () => {
    const legacy = normalizeActivityFeed(dashboardFeed([destination]), '1h')
    const current = normalizeActivityFeed(dashboardFeed([{
      ...destination,
      kind: 'rest',
      method: 'GET',
    }]), '1h')

    expect(legacy.compatibilityLimited).toBe(false)
    expect(current.compatibilityLimited).toBe(false)
    expect(current.data?.topByName[0]).toMatchObject({
      kind: 'rest',
      method: 'GET',
    })
  })

  it('rejects invalid signature metadata at the compatibility boundary', () => {
    const invalidRows = [
      { ...destination, kind: 'cli' },
      { ...destination, method: '' },
    ]

    for (const row of invalidRows) {
      const normalized = normalizeActivityFeed(dashboardFeed([row]), '1h')
      expect(normalized.compatibilityLimited).toBe(true)
      expect(normalized.data?.topByName).toEqual([])
    }
  })

  it('keeps capability metadata forward-compatible while rejecting a malformed known value', () => {
    const currentFeed = dashboardFeed([destination])
    currentFeed.capabilities = { exactFailureTargeting: true, sourceBalancedActivity: true }
    const current = normalizeActivityFeed(currentFeed, '1h')

    const forwardFeed = dashboardFeed([destination])
    ;(forwardFeed as unknown as {
      capabilities: { exactFailureTargeting: boolean; futureCapability: boolean }
    }).capabilities = { exactFailureTargeting: false, futureCapability: true }
    const forward = normalizeActivityFeed(forwardFeed, '1h')

    const invalidFeed = dashboardFeed([destination])
    ;(invalidFeed as unknown as {
      capabilities: { exactFailureTargeting: string }
    }).capabilities = { exactFailureTargeting: 'yes' }
    const invalid = normalizeActivityFeed(invalidFeed, '1h')

    const invalidBalancedFeed = dashboardFeed([destination])
    ;(invalidBalancedFeed as unknown as {
      capabilities: { sourceBalancedActivity: string }
    }).capabilities = { sourceBalancedActivity: 'yes' }
    const invalidBalanced = normalizeActivityFeed(invalidBalancedFeed, '1h')

    expect(current.compatibilityLimited).toBe(false)
    expect(current.data?.capabilities).toEqual({
      exactFailureTargeting: true,
      sourceBalancedActivity: true,
    })
    expect(forward.compatibilityLimited).toBe(false)
    expect(forward.data?.capabilities?.exactFailureTargeting).toBe(false)
    expect(invalid.compatibilityLimited).toBe(true)
    expect(invalid.data?.capabilities).toBeUndefined()
    expect(invalidBalanced.compatibilityLimited).toBe(true)
    expect(invalidBalanced.data?.capabilities).toBeUndefined()
  })
})
