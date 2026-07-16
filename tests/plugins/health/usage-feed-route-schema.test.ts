import { describe, expect, it } from 'bun:test'

import {
  isUsageFeedResponse,
  usageFeedResponseSchema,
  type UsageFeedResponse,
} from '../../../plugins/health/lib/usage-feed-route-schema'

function currentFeed(): UsageFeedResponse {
  const observedAt = '2026-07-15T12:00:00.000Z'
  const entry = {
    id: 'usage-1',
    ts: observedAt,
    kind: 'mcp' as const,
    activityClass: 'user' as const,
    name: 'web.search',
    agent: 'main',
    durationMs: 12,
    status: 'error' as const,
  }

  return {
    capabilities: {
      exactFailureTargeting: true,
      sourceBalancedActivity: true,
    },
    window: '1h',
    coverage: {
      startsAt: '2026-07-15T11:00:00.000Z',
      hasFullWindow: true,
      reason: 'full_window',
    },
    totals: { count: 1, errors: 1, errorRate: 1 },
    outcomes: { failed: 1, unverified: 0, canceled: 0, succeeded: 0 },
    byKind: [
      { kind: 'mcp', total: 1, failures: 1 },
      { kind: 'rest', total: 0, failures: 0 },
      { kind: 'agent', total: 0, failures: 0 },
    ],
    failureGroups: [{
      kind: 'mcp',
      name: 'web.search',
      destination: 'web.search',
      method: null,
      attempts: 1,
      failures: 1,
      firstFailureAt: observedAt,
      lastFailureAt: observedAt,
      agents: ['main'],
      unattributedFailures: 0,
      systemFailures: 0,
      medianFailureDurationMs: 12,
      latestFailure: entry,
    }],
    failureGroupPage: { total: 1, offset: 0, limit: 25, hasMore: false },
    topByName: [{
      kind: 'mcp',
      method: null,
      name: 'web.search',
      count: 1,
      errors: 1,
      medianDurationMs: 12,
    }],
    agentCount: 1,
    byAgent: [{
      agent: 'main',
      attributed: true,
      count: 1,
      errors: 1,
      lastActivity: entry,
    }],
    recent: [entry],
    recentFailures: [entry],
    recentUnverified: [],
    timeBuckets: [{ start: observedAt, count: 1, failureCount: 1, failureRate: 1 }],
  }
}

describe('usageFeedResponseSchema', () => {
  it('accepts the canonical Activity response and matches the requested window', () => {
    const feed = currentFeed()

    expect(usageFeedResponseSchema.safeParse(feed).success).toBe(true)
    expect(isUsageFeedResponse(feed, '1h')).toBe(true)
    expect(isUsageFeedResponse(feed, '24h')).toBe(false)
  })

  it('rejects internally inconsistent dashboard totals', () => {
    const feed = currentFeed()
    feed.outcomes.succeeded = 1

    const result = usageFeedResponseSchema.safeParse(feed)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'outcomes')).toBe(true)
    }
  })

  it('rejects malformed nested evidence at the browser boundary', () => {
    const feed = currentFeed() as unknown as {
      recent: Array<{ tokensIn?: number }>
    }
    feed.recent[0]!.tokensIn = -1

    expect(usageFeedResponseSchema.safeParse(feed).success).toBe(false)
  })
})
