import { describe, expect, it } from 'bun:test'
import { normalizeActivityFeed } from '../../../plugins/health/lib/activity-feed-compat'
import type { UsageFeedData } from '../../../plugins/health/types'

function dashboardFeed(topByName: Array<Record<string, unknown>>): UsageFeedData {
  return {
    capabilities: { exactFailureTargeting: true, sourceBalancedActivity: true },
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
    agentCount: 0,
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

    expect(legacy.compatibilityLimited).toBe(true)
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

  it('accepts the current capability contract and isolates older or malformed values', () => {
    const currentFeed = dashboardFeed([{ ...destination, kind: 'mcp', method: null }])
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
    expect(forward.compatibilityLimited).toBe(true)
    expect(forward.data?.capabilities).toBeUndefined()
    expect(invalid.compatibilityLimited).toBe(true)
    expect(invalid.data?.capabilities).toBeUndefined()
    expect(invalidBalanced.compatibilityLimited).toBe(true)
    expect(invalidBalanced.data?.capabilities).toBeUndefined()
  })

  it('uses the canonical browser schema before projecting a legacy payload', () => {
    const feed = dashboardFeed([{ ...destination, kind: 'mcp', method: null }])
    feed.recent = [{
      id: 'usage-invalid-token-count',
      ts: '2026-07-14T12:00:00.000Z',
      kind: 'mcp',
      activityClass: 'user',
      name: 'web.search',
      agent: 'main',
      durationMs: 1,
      status: 'ok',
      tokensIn: -1,
    }]

    const normalized = normalizeActivityFeed(feed, '1h')

    expect(normalized.compatibilityLimited).toBe(true)
    expect(normalized.data?.recent).toEqual([])
  })

  it('does not relabel a canonical response from a different requested window', () => {
    const feed = dashboardFeed([{ ...destination, kind: 'mcp', method: null }])

    const normalized = normalizeActivityFeed(feed, '24h')

    expect(normalized).toEqual({ data: null, compatibilityLimited: false })
  })
})

describe('normalizeActivityFeed compatibility fallback', () => {
  it('drops malformed agent rows while preserving valid rows', () => {
    const feed = dashboardFeed([])
    const validAgent = { agent: 'main', count: 1, errors: 0, lastActivity: null }
    feed.byAgent = [validAgent, null] as unknown as UsageFeedData['byAgent']

    const normalized = normalizeActivityFeed(feed, '1h')

    expect(normalized.compatibilityLimited).toBe(true)
    expect(normalized.data?.byAgent).toEqual([validAgent])
  })

  it('does not trust an exact agent count that exceeds total interactions', () => {
    const feed = dashboardFeed([])
    feed.agentCount = 999
    feed.byAgent = [{ agent: 'main', count: 1, errors: 0, lastActivity: null }]

    const normalized = normalizeActivityFeed(feed, '1h')

    expect(normalized.compatibilityLimited).toBe(true)
    expect(normalized.data?.agentCount).toBe(1)
  })

  it('bounds an oversized legacy agent projection at the compatibility boundary', () => {
    const feed = dashboardFeed([])
    feed.totals = { count: 20, errors: 0, errorRate: 0 }
    feed.outcomes = { failed: 0, unverified: 0, canceled: 0, succeeded: 20 }
    feed.byKind = [
      { kind: 'mcp', total: 20, failures: 0 },
      { kind: 'rest', total: 0, failures: 0 },
      { kind: 'agent', total: 0, failures: 0 },
    ]
    feed.byAgent = Array.from({ length: 20 }, (_, index) => ({
      agent: `agent-${index}`,
      count: 1,
      errors: 0,
      lastActivity: null,
    }))

    const normalized = normalizeActivityFeed(feed, '1h')

    expect(normalized.compatibilityLimited).toBe(true)
    expect(normalized.data?.agentCount).toBe(20)
    expect(normalized.data?.byAgent).toHaveLength(10)
  })
})
