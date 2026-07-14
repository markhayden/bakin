import { describe, it, expect, beforeEach, mock, setSystemTime, spyOn } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-usage-test-${Date.now()}`)

// Usage recorder is pure in-memory — no filesystem access. This mock is a
// defensive safeguard per CLAUDE.md's absolute test isolation rule.
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    root: testDir,
    settings: join(testDir, 'settings.json'),
    audit: join(testDir, 'audit.jsonl'),
    logs: join(testDir, 'logs'),
  }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    root: testDir,
    settings: join(testDir, 'settings.json'),
    audit: join(testDir, 'audit.jsonl'),
    logs: join(testDir, 'logs'),
  }),
}))

import {
  recordUsage,
  getUsageFeed,
  getInteractionSummary,
  getUsageStats,
  getStatsByMs,
  getErrorCount,
  getCurrentAgentActivity,
  isAgentIdle,
  clearUsage,
  getEntryCount,
  WINDOW_MS,
} from '../../src/core/usage'

function seed(overrides: Partial<Parameters<typeof recordUsage>[0]> = {}) {
  recordUsage({
    kind: 'mcp',
    activityClass: 'user',
    name: 'bakin_exec_tasks_list',
    agent: 'main-operator',
    durationMs: 10,
    status: 'ok',
    ...overrides,
  })
}

type ActivityDashboardFeed = ReturnType<typeof getUsageFeed> & {
  window: '5m' | '1h' | '24h'
  coverage: {
    startsAt: string
    hasFullWindow: boolean
    reason: 'full_window' | 'process_restart' | 'buffer_limit'
  }
  outcomes: {
    failed: number
    unverified: number
    canceled: number
    succeeded: number
  }
  byKind: Array<{
    kind: 'mcp' | 'rest' | 'agent'
    total: number
    failures: number
  }>
  failureGroups: Array<{
    kind: 'mcp' | 'rest' | 'agent'
    name: string
    destination: string
    method: string | null
    attempts: number
    failures: number
    firstFailureAt: string
    lastFailureAt: string
    agents: string[]
    unattributedFailures: number
    systemFailures: number
    medianFailureDurationMs: number | null
    latestFailure: ReturnType<typeof getUsageFeed>['recentFailures'][number]
  }>
  failureGroupPage: {
    total: number
    offset: number
    limit: number
    hasMore: boolean
  }
}

describe('usage recorder', () => {
  beforeEach(() => clearUsage())

  describe('recordUsage + getUsageFeed basics', () => {
    it('records an entry and retrieves it in the feed', () => {
      seed({ name: 'tool_a' })
      const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
      expect(feed.totals.count).toBe(1)
      expect(feed.topByName[0]).toMatchObject({ name: 'tool_a', count: 1, errors: 0 })
      expect(feed.recent).toHaveLength(1)
      expect(feed.recent[0].id).toMatch(/^usage-/)
      expect(feed.recentFailures).toEqual([])
      expect(feed.recentUnverified).toEqual([])
    })

    it('preserves cache token fields on agent-turn entries', () => {
      recordUsage({
        kind: 'agent', activityClass: 'user', name: 'turn', agent: 'pixel', durationMs: null, status: 'ok',
        tokensIn: 1000, tokensOut: 50, tokensCacheRead: 900, tokensCacheWrite: 40,
      })
      const feed = getUsageFeed({ kind: 'agent', window: '5m' })
      expect(feed.recent[0]).toMatchObject({ tokensCacheRead: 900, tokensCacheWrite: 40 })
      // Entries without cache usage keep the fields absent — never zeroed.
      // Find by content, not position: recent[] is ts-DESC sorted, and the
      // two entries only keep insertion order when they tie on the same
      // millisecond — a positional index is a coin flip on slower runners.
      recordUsage({ kind: 'agent', activityClass: 'user', name: 'turn', agent: 'pixel', durationMs: null, status: 'ok', tokensIn: 10 })
      const feed2 = getUsageFeed({ kind: 'agent', window: '5m' })
      const noCacheEntry = feed2.recent.find((e) => e.tokensIn === 10)
      expect(noCacheEntry).toBeDefined()
      expect('tokensCacheRead' in noCacheEntry!).toBe(false)
    })

    it('merges a metered agent turn into its runtime observation without double-counting', () => {
      recordUsage({
        kind: 'agent',
        activityClass: 'system',
        name: 'send',
        agent: 'main',
        durationMs: 240,
        status: 'ok',
        meta: { source: 'runtime-turn', turnId: 'turn-1', resultId: 'result-1', threadId: 'chat:1' },
      })
      const originalId = getUsageFeed({ kind: 'agent', window: '5m' }).recent[0].id
      recordUsage({
        kind: 'agent',
        activityClass: 'system',
        name: 'watchdog-alert',
        agent: 'main',
        durationMs: null,
        status: 'ok',
        tokensIn: 100,
        tokensOut: 20,
        costUsdMicros: 4_200,
        meta: { turnId: 'turn-1', resultId: 'result-1', model: 'provider/model' },
      })

      const feed = getUsageFeed({ kind: 'agent', window: '5m' })
      expect(feed.totals).toEqual({ count: 1, errors: 0, errorRate: 0 })
      expect(feed.recent[0]).toMatchObject({
        id: originalId,
        name: 'watchdog-alert',
        durationMs: 240,
        tokensIn: 100,
        tokensOut: 20,
        costUsdMicros: 4_200,
        meta: {
          source: 'runtime-turn',
          turnId: 'turn-1',
          resultId: 'result-1',
          threadId: 'chat:1',
          model: 'provider/model',
        },
      })
    })

    it('keeps concurrent same-millisecond agent results distinct by adapter turn id', () => {
      for (const turnId of ['turn-a', 'turn-b']) {
        recordUsage({
          kind: 'agent',
          activityClass: 'user',
          name: 'send',
          agent: 'main',
          durationMs: 10,
          status: 'ok',
          meta: { source: 'runtime-turn', turnId, resultId: 'msg-1000' },
        })
      }
      recordUsage({
        kind: 'agent', activityClass: 'user', name: 'turn-a', agent: 'main', durationMs: null, status: 'ok',
        tokensIn: 10, meta: { turnId: 'turn-a', resultId: 'msg-1000' },
      })
      recordUsage({
        kind: 'agent', activityClass: 'user', name: 'turn-b', agent: 'main', durationMs: null, status: 'ok',
        tokensIn: 20, meta: { turnId: 'turn-b', resultId: 'msg-1000' },
      })

      const feed = getUsageFeed({ kind: 'agent', window: '5m' })
      expect(feed.totals.count).toBe(2)
      expect(feed.recent.map((entry) => entry.tokensIn).sort((left, right) => (left ?? 0) - (right ?? 0))).toEqual([10, 20])
      expect(new Set(feed.recent.map((entry) => entry.meta?.turnId))).toEqual(new Set(['turn-a', 'turn-b']))
    })

    it('tracks errors and errorRate', () => {
      seed({ status: 'ok' })
      seed({ status: 'error' })
      seed({ status: 'ok' })
      const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
      expect(feed.totals.count).toBe(3)
      expect(feed.totals.errors).toBe(1)
      expect(feed.totals.errorRate).toBeCloseTo(1 / 3, 5)
    })

    it('hides successful routine entries by default but always keeps failed routine work', () => {
      seed({ name: 'foreground', activityClass: 'user', status: 'ok' })
      seed({ name: 'background', activityClass: 'system', status: 'ok' })
      seed({ name: 'poll-ok', activityClass: 'routine', status: 'ok' })
      seed({ name: 'poll-failed', activityClass: 'routine', agent: null, status: 'error' })

      const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
      expect(feed.totals).toMatchObject({ count: 3, errors: 1 })
      expect(feed.recent.map((entry) => entry.name).sort()).toEqual([
        'background',
        'foreground',
        'poll-failed',
      ])
      expect(feed.recent.find((entry) => entry.name === 'poll-failed')?.activityClass).toBe('routine')
      expect(feed.failureGroups.find((group) => group.name === 'poll-failed')).toMatchObject({
        unattributedFailures: 0,
        systemFailures: 1,
      })
    })

    it('includes successful routine entries only when includeRoutine is explicit', () => {
      seed({ name: 'poll-ok', activityClass: 'routine', status: 'ok' })
      seed({ name: 'poll-failed', activityClass: 'routine', status: 'error' })

      const feed = getUsageFeed({ kind: 'mcp', window: '5m', includeRoutine: true })
      expect(feed.totals).toMatchObject({ count: 2, errors: 1 })
      expect(feed.recent.map((entry) => entry.name).sort()).toEqual(['poll-failed', 'poll-ok'])
    })

    it('keeps routine canceled work in the default feed and counts it as canceled', () => {
      seed({ name: 'poll-ok', activityClass: 'routine', status: 'ok' })
      seed({
        name: 'poll-canceled',
        activityClass: 'routine',
        status: 'ok',
        meta: { terminalStatus: 'aborted' },
      })

      const feed = getUsageFeed({ kind: 'mcp', window: '5m' }) as ActivityDashboardFeed

      expect(feed.totals).toEqual({ count: 1, errors: 0, errorRate: 0 })
      expect(feed.outcomes).toEqual({ failed: 0, unverified: 0, canceled: 1, succeeded: 0 })
      expect(feed.recent).toHaveLength(1)
      expect(feed.recent[0]).toMatchObject({
        name: 'poll-canceled',
        activityClass: 'routine',
        meta: { terminalStatus: 'aborted' },
      })
      expect(getInteractionSummary({ window: '5m' }).totals).toEqual({
        count: 1,
        errors: 0,
        unverified: 0,
        foreground: 0,
        background: 1,
      })
      expect(getUsageStats({ kind: 'mcp', window: '5m' })).toEqual({ total: 1, errors: 0 })
      expect(getStatsByMs({ kind: 'mcp', windowMs: WINDOW_MS['5m'] })).toEqual({ total: 1, errors: 0 })
    })

    it('returns stable ascending failure buckets, including empty buckets', () => {
      setSystemTime(new Date('2026-07-13T12:00:00.000Z'))
      try {
        seed({
          name: 'first-ok',
          status: 'ok',
          ts: '2026-07-13T11:55:10.000Z',
        })
        seed({
          name: 'last-error',
          status: 'error',
          ts: '2026-07-13T11:59:45.000Z',
        })

        const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
        expect(feed.timeBuckets).toHaveLength(10)
        expect(feed.timeBuckets[0]).toEqual({
          start: '2026-07-13T11:55:00.000Z',
          count: 1,
          failureCount: 0,
          failureRate: 0,
        })
        expect(feed.timeBuckets[1]).toEqual({
          start: '2026-07-13T11:55:30.000Z',
          count: 0,
          failureCount: 0,
          failureRate: 0,
        })
        expect(feed.timeBuckets[9]).toEqual({
          start: '2026-07-13T11:59:30.000Z',
          count: 1,
          failureCount: 1,
          failureRate: 1,
        })
        expect(feed.timeBuckets.map((bucket) => bucket.start)).toEqual(
          [...feed.timeBuckets.map((bucket) => bucket.start)].sort(),
        )
      } finally {
        setSystemTime()
      }
    })

    it('keeps older failures and result gaps inspectable after the recent cap fills with successes', () => {
      const now = Date.now()
      seed({
        name: 'older-failure',
        status: 'error',
        ts: new Date(now - 10_000).toISOString(),
      })
      seed({
        name: 'older-unverified',
        activityClass: 'routine',
        status: 'ok',
        ts: new Date(now - 11_000).toISOString(),
        meta: { resultMissing: true, turnTerminalStatus: 'completed' },
      })
      for (let index = 0; index < 60; index++) {
        seed({
          name: `newer-success-${index}`,
          status: 'ok',
          ts: new Date(now - 9_000 + index).toISOString(),
        })
      }

      const feed = getUsageFeed({ window: '5m' })

      expect(feed.recent).toHaveLength(50)
      expect(feed.recent.some((entry) => entry.name === 'older-failure')).toBe(false)
      expect(feed.recent.some((entry) => entry.name === 'older-unverified')).toBe(false)
      expect(feed.recentFailures).toHaveLength(1)
      expect(feed.recentFailures[0]).toMatchObject({ name: 'older-failure', status: 'error' })
      expect(feed.recentUnverified).toHaveLength(1)
      expect(feed.recentUnverified[0]).toMatchObject({
        name: 'older-unverified',
        activityClass: 'routine',
      })
    })

    it('reports the requested window, trustworthy coverage, and exact outcomes by activity kind', () => {
      setSystemTime(new Date('2026-07-13T12:00:00.000Z'))
      const uptime = spyOn(process, 'uptime').mockReturnValue(2 * 60 * 60)
      try {
        seed({ kind: 'mcp', name: 'tool-failed', status: 'error', ts: '2026-07-13T11:10:00.000Z' })
        seed({ kind: 'mcp', name: 'tool-unverified', status: 'ok', ts: '2026-07-13T11:11:00.000Z', meta: { resultMissing: true, turnTerminalStatus: 'completed' } })
        seed({ kind: 'mcp', name: 'tool-canceled', status: 'ok', ts: '2026-07-13T11:12:00.000Z', meta: { resultMissing: true, turnTerminalStatus: 'aborted' } })
        seed({ kind: 'mcp', name: 'tool-succeeded', status: 'ok', ts: '2026-07-13T11:13:00.000Z' })
        seed({ kind: 'rest', name: '/api/failed', status: 'error', ts: '2026-07-13T11:14:00.000Z' })
        seed({ kind: 'rest', name: '/api/succeeded', status: 'ok', ts: '2026-07-13T11:15:00.000Z' })
        seed({ kind: 'agent', name: 'dispatch-failed', status: 'error', ts: '2026-07-13T11:16:00.000Z' })
        seed({ kind: 'agent', name: 'dispatch-canceled', status: 'ok', ts: '2026-07-13T11:17:00.000Z', meta: { terminalStatus: 'aborted' } })
        seed({ kind: 'agent', name: 'dispatch-succeeded', status: 'ok', ts: '2026-07-13T11:18:00.000Z' })

        const feed = getUsageFeed({ window: '1h' }) as ActivityDashboardFeed

        expect(feed.window).toBe('1h')
        expect(feed.coverage).toEqual({
          startsAt: '2026-07-13T11:00:00.000Z',
          hasFullWindow: true,
          reason: 'full_window',
        })
        expect(feed.outcomes).toEqual({
          failed: 3,
          unverified: 1,
          canceled: 2,
          succeeded: 3,
        })
        expect(feed.byKind).toEqual([
          { kind: 'mcp', total: 4, failures: 1 },
          { kind: 'rest', total: 2, failures: 1 },
          { kind: 'agent', total: 3, failures: 1 },
        ])
      } finally {
        uptime.mockRestore()
        setSystemTime()
      }
    })

    it('groups failures by kind and name, then sorts by failure count and recency', () => {
      setSystemTime(new Date('2026-07-13T12:00:00.000Z'))
      try {
        seed({ kind: 'mcp', name: 'shared-destination', agent: 'main', status: 'error', durationMs: 20, ts: '2026-07-13T11:10:00.000Z' })
        seed({ kind: 'mcp', name: 'shared-destination', agent: 'main', status: 'error', durationMs: 40, ts: '2026-07-13T11:20:00.000Z' })
        seed({ kind: 'mcp', name: 'shared-destination', agent: 'pixel', status: 'ok', durationMs: 5, ts: '2026-07-13T11:30:00.000Z' })
        seed({ kind: 'rest', name: 'shared-destination', agent: 'main', status: 'error', durationMs: 10, ts: '2026-07-13T11:35:00.000Z' })
        seed({ kind: 'rest', name: 'shared-destination', agent: null, status: 'error', durationMs: 50, ts: '2026-07-13T11:40:00.000Z' })
        seed({ kind: 'rest', name: 'shared-destination', agent: 'scout', status: 'error', durationMs: 30, ts: '2026-07-13T11:50:00.000Z' })
        seed({ kind: 'rest', name: 'shared-destination', agent: 'pixel', status: 'ok', durationMs: 5, ts: '2026-07-13T11:55:00.000Z' })
        seed({ kind: 'agent', name: 'dispatch', agent: 'patch', status: 'error', durationMs: null, ts: '2026-07-13T11:58:00.000Z' })

        const feed = getUsageFeed({ window: '1h' }) as ActivityDashboardFeed

        expect(feed.failureGroupPage).toEqual({ total: 3, offset: 0, limit: 25, hasMore: false })
        expect(feed.failureGroups).toEqual([
          {
            kind: 'rest',
            name: 'shared-destination',
            destination: 'shared-destination',
            method: null,
            attempts: 4,
            failures: 3,
            firstFailureAt: '2026-07-13T11:35:00.000Z',
            lastFailureAt: '2026-07-13T11:50:00.000Z',
            agents: ['main', 'scout'],
            unattributedFailures: 1,
            systemFailures: 0,
            medianFailureDurationMs: 30,
            latestFailure: expect.objectContaining({
              name: 'shared-destination',
              agent: 'scout',
              ts: '2026-07-13T11:50:00.000Z',
            }),
          },
          {
            kind: 'mcp',
            name: 'shared-destination',
            destination: 'shared-destination',
            method: null,
            attempts: 3,
            failures: 2,
            firstFailureAt: '2026-07-13T11:10:00.000Z',
            lastFailureAt: '2026-07-13T11:20:00.000Z',
            agents: ['main'],
            unattributedFailures: 0,
            systemFailures: 0,
            medianFailureDurationMs: 30,
            latestFailure: expect.objectContaining({
              name: 'shared-destination',
              agent: 'main',
              ts: '2026-07-13T11:20:00.000Z',
            }),
          },
          {
            kind: 'agent',
            name: 'dispatch',
            destination: 'dispatch',
            method: null,
            attempts: 1,
            failures: 1,
            firstFailureAt: '2026-07-13T11:58:00.000Z',
            lastFailureAt: '2026-07-13T11:58:00.000Z',
            agents: ['patch'],
            unattributedFailures: 0,
            systemFailures: 0,
            medianFailureDurationMs: null,
            latestFailure: expect.objectContaining({
              name: 'dispatch',
              agent: 'patch',
              ts: '2026-07-13T11:58:00.000Z',
            }),
          },
        ])
      } finally {
        setSystemTime()
      }
    })

    it('uses hidden routine successes as denominator evidence for a failed pattern', () => {
      for (let attempt = 0; attempt < 59; attempt++) {
        seed({
          kind: 'mcp',
          activityClass: 'routine',
          name: 'search_poll',
          status: 'ok',
        })
      }
      seed({
        kind: 'mcp',
        activityClass: 'routine',
        name: 'search_poll',
        status: 'error',
      })

      const feed = getUsageFeed({ window: '5m' }) as ActivityDashboardFeed

      expect(feed.totals).toEqual({ count: 1, errors: 1, errorRate: 1 })
      expect(feed.failureGroups).toHaveLength(1)
      expect(feed.failureGroups[0]).toMatchObject({
        name: 'search_poll',
        failures: 1,
        attempts: 60,
      })
    })

    it('uses hidden successful MCP transports as denominator evidence for a failed transport', () => {
      for (let attempt = 0; attempt < 59; attempt++) {
        seed({
          kind: 'rest',
          activityClass: 'user',
          name: '/mcp',
          status: 'ok',
          meta: { method: 'POST', httpStatus: 200 },
        })
      }
      seed({
        kind: 'rest',
        activityClass: 'user',
        name: '/mcp',
        status: 'error',
        meta: { method: 'POST', httpStatus: 503 },
      })

      const feed = getUsageFeed({ kind: 'rest', window: '5m' }) as ActivityDashboardFeed

      expect(feed.totals).toEqual({ count: 1, errors: 1, errorRate: 1 })
      expect(feed.failureGroups).toHaveLength(1)
      expect(feed.failureGroups[0]).toMatchObject({
        destination: '/mcp',
        method: 'POST',
        failures: 1,
        attempts: 60,
      })
    })

    it('keeps exact grouped and outcome totals after the recent failure list reaches its cap', () => {
      setSystemTime(new Date('2026-07-13T12:00:00.000Z'))
      try {
        for (let index = 0; index < 51; index++) {
          seed({
            kind: 'mcp',
            name: 'web_search',
            agent: index % 2 === 0 ? 'main' : 'scout',
            status: 'error',
            durationMs: index + 1,
            ts: new Date(Date.parse('2026-07-13T11:10:00.000Z') + index * 1000).toISOString(),
            meta: { sequence: index },
          })
        }
        seed({
          kind: 'mcp',
          name: 'web_search',
          agent: 'pixel',
          status: 'ok',
          durationMs: 5,
          ts: '2026-07-13T11:20:00.000Z',
        })

        const feed = getUsageFeed({ window: '1h' }) as ActivityDashboardFeed

        expect(feed.outcomes).toEqual({ failed: 51, unverified: 0, canceled: 0, succeeded: 1 })
        expect(feed.byKind).toEqual([
          { kind: 'mcp', total: 52, failures: 51 },
          { kind: 'rest', total: 0, failures: 0 },
          { kind: 'agent', total: 0, failures: 0 },
        ])
        expect(feed.failureGroupPage).toEqual({ total: 1, offset: 0, limit: 25, hasMore: false })
        expect(feed.failureGroups).toEqual([{
          kind: 'mcp',
          name: 'web_search',
          destination: 'web_search',
          method: null,
          attempts: 52,
          failures: 51,
          firstFailureAt: '2026-07-13T11:10:00.000Z',
          lastFailureAt: '2026-07-13T11:10:50.000Z',
          agents: ['main', 'scout'],
          unattributedFailures: 0,
          systemFailures: 0,
          medianFailureDurationMs: 26,
          latestFailure: expect.objectContaining({
            name: 'web_search',
            meta: { sequence: 50 },
            ts: '2026-07-13T11:10:50.000Z',
          }),
        }])
        expect(feed.recentFailures).toHaveLength(50)
        expect(feed.recentFailures.map((entry) => entry.meta?.sequence)).toEqual(
          Array.from({ length: 50 }, (_, index) => 50 - index),
        )
      } finally {
        setSystemTime()
      }
    })

    it('paginates logical failure groups by REST method and route destination with representative evidence', () => {
      setSystemTime(new Date('2026-07-13T12:00:00.000Z'))
      try {
        const routePattern = '/api/plugins/tasks/:taskId'
        for (let index = 0; index < 3; index++) {
          seed({
            kind: 'rest',
            name: `/api/plugins/tasks/get-${index}`,
            agent: 'main',
            status: 'error',
            durationMs: 10 + index,
            ts: new Date(Date.parse('2026-07-13T11:10:00.000Z') + index * 1000).toISOString(),
            meta: { routePattern, method: 'get', error: `GET failed ${index}` },
          })
        }
        for (let index = 0; index < 2; index++) {
          seed({
            kind: 'rest',
            name: `/api/plugins/tasks/post-${index}`,
            agent: index === 0 ? null : 'pixel',
            status: 'error',
            durationMs: 20 + index,
            ts: new Date(Date.parse('2026-07-13T11:20:00.000Z') + index * 1000).toISOString(),
            meta: { routePattern, method: 'POST', error: `POST failed ${index}` },
          })
        }
        seed({
          kind: 'mcp',
          name: 'web_search',
          agent: 'scout',
          status: 'error',
          durationMs: 30,
          ts: '2026-07-13T11:30:00.000Z',
          meta: { error: 'Search unavailable' },
        })

        const feed = getUsageFeed({
          window: '1h',
          failureGroupOffset: 1,
          failureGroupLimit: 1,
        }) as ActivityDashboardFeed

        expect(feed.outcomes.failed).toBe(6)
        expect(feed.failureGroupPage).toEqual({
          total: 3,
          offset: 1,
          limit: 1,
          hasMore: true,
        })
        expect(feed.failureGroups).toHaveLength(1)
        expect(feed.failureGroups[0]).toMatchObject({
          kind: 'rest',
          name: routePattern,
          destination: routePattern,
          method: 'POST',
          attempts: 2,
          failures: 2,
          agents: ['pixel'],
          unattributedFailures: 1,
          systemFailures: 0,
          latestFailure: {
            name: '/api/plugins/tasks/post-1',
            status: 'error',
            meta: { routePattern, method: 'POST', error: 'POST failed 1' },
          },
        })

        const finalPage = getUsageFeed({
          window: '1h',
          failureGroupOffset: 2,
          failureGroupLimit: 1,
        }) as ActivityDashboardFeed
        expect(finalPage.failureGroupPage).toEqual({
          total: 3,
          offset: 2,
          limit: 1,
          hasMore: false,
        })
        expect(finalPage.failureGroups[0]).toMatchObject({
          kind: 'mcp',
          name: 'web_search',
          destination: 'web_search',
          method: null,
          latestFailure: { name: 'web_search' },
        })
      } finally {
        setSystemTime()
      }
    })

    it('resolves the current page for an exact failure target after its rank moves', () => {
      setSystemTime(new Date('2026-07-13T12:00:00.000Z'))
      try {
        const target = {
          kind: 'rest' as const,
          method: 'GET',
          destination: '/api/plugins/search/query',
        }
        seed({
          kind: target.kind,
          name: target.destination,
          status: 'error',
          ts: '2026-07-13T11:10:00.000Z',
          meta: { method: target.method, routePattern: target.destination },
        })
        seed({
          kind: 'mcp',
          name: 'initial-leader',
          status: 'error',
          ts: '2026-07-13T11:20:00.000Z',
        })

        expect(getUsageFeed({
          window: '1h',
          failureGroupLimit: 1,
          failureGroupTarget: target,
        }).failureGroupPage.offset).toBe(1)

        for (let index = 0; index < 2; index++) {
          seed({
            kind: 'agent',
            name: `new-leader-${index}`,
            status: 'error',
            ts: new Date(Date.parse('2026-07-13T11:30:00.000Z') + index * 1000).toISOString(),
          })
        }

        const moved = getUsageFeed({
          window: '1h',
          failureGroupOffset: 0,
          failureGroupLimit: 1,
          failureGroupTarget: target,
        })
        expect(moved.failureGroupPage.offset).toBe(3)
        expect(moved.failureGroups).toEqual([
          expect.objectContaining(target),
        ])
      } finally {
        setSystemTime()
      }
    })

    it('matches failure targets by kind, method, and destination', () => {
      const destination = '/api/plugins/search/query'
      for (const method of ['GET', 'POST']) {
        seed({
          kind: 'rest',
          name: destination,
          status: 'error',
          meta: { method, routePattern: destination },
        })
      }
      seed({ kind: 'mcp', name: destination, status: 'error' })

      const feed = getUsageFeed({
        window: '5m',
        failureGroupLimit: 1,
        failureGroupTarget: { kind: 'rest', method: 'POST', destination },
      })

      expect(feed.failureGroups).toEqual([
        expect.objectContaining({ kind: 'rest', method: 'POST', destination }),
      ])
    })

    it('auto-stamps ts if not provided', () => {
      seed()
      const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
      expect(() => new Date(feed.recent[0].ts)).not.toThrow()
      expect(new Date(feed.recent[0].ts).getTime()).toBeGreaterThan(0)
    })
  })

  describe('getInteractionSummary', () => {
    it('summarizes meaningful Bakin interactions without successful routine traffic', () => {
      setSystemTime(new Date('2026-07-13T12:00:00.000Z'))
      const uptime = spyOn(process, 'uptime').mockReturnValue(2 * 60 * 60)
      try {
        seed({ kind: 'mcp', activityClass: 'user', name: 'bakin_exec_images_generate', status: 'ok' })
        seed({ kind: 'mcp', activityClass: 'routine', name: 'health_poll', status: 'ok' })
        seed({ kind: 'rest', activityClass: 'system', name: '/api/search/drain', agent: null, status: 'ok' })
        seed({ kind: 'rest', activityClass: 'user', name: '/api/plugins/tasks/list', agent: null, status: 'error' })
        seed({ kind: 'agent', activityClass: 'user', name: 'dispatch', status: 'ok', durationMs: null })
        seed({ kind: 'agent', activityClass: 'routine', name: 'heartbeat', status: 'ok', durationMs: null })

        const summary = getInteractionSummary({ window: '1h' })

        expect(summary.window).toBe('1h')
        expect(summary.coverage).toEqual({
          startsAt: '2026-07-13T11:00:00.000Z',
          hasFullWindow: true,
          reason: 'full_window',
        })
        expect(summary.totals).toEqual({
          count: 4,
          errors: 1,
          unverified: 0,
          foreground: 3,
          background: 1,
        })
        expect(summary.categories).toEqual([
          { key: 'tools', count: 1, errors: 0 },
          { key: 'api', count: 2, errors: 1 },
          { key: 'agents', count: 1, errors: 0 },
        ])
        expect(summary.timeBuckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(4)
        expect(summary.timeBuckets.reduce((total, bucket) => total + bucket.failureCount, 0)).toBe(1)
        expect(summary.timeBuckets.map((bucket) => bucket.start)).toEqual(
          [...summary.timeBuckets.map((bucket) => bucket.start)].sort(),
        )
      } finally {
        uptime.mockRestore()
        setSystemTime()
      }
    })

    it('reports partial coverage from process start when uptime is shorter than the window', () => {
      setSystemTime(new Date('2026-07-13T12:00:00.000Z'))
      const uptime = spyOn(process, 'uptime').mockReturnValue(15 * 60)
      try {
        const summary = getInteractionSummary({ window: '1h' })

        expect(summary.coverage).toEqual({
          startsAt: '2026-07-13T11:45:00.000Z',
          hasFullWindow: false,
          reason: 'process_restart',
        })
      } finally {
        uptime.mockRestore()
        setSystemTime()
      }
    })

    it('counts one logical interaction for an MCP tool and hides its HTTP transport from the activity feed', () => {
      seed({
        kind: 'mcp',
        activityClass: 'user',
        name: 'bakin_exec_tasks_list',
        status: 'ok',
      })
      seed({
        kind: 'rest',
        activityClass: 'user',
        name: '/mcp',
        status: 'ok',
        meta: { method: 'POST', httpStatus: 200 },
      })

      const summary = getInteractionSummary({ window: '1h' })

      expect(summary.totals).toEqual({ count: 1, errors: 0, unverified: 0, foreground: 1, background: 0 })
      expect(summary.categories).toEqual([
        { key: 'tools', count: 1, errors: 0 },
        { key: 'api', count: 0, errors: 0 },
        { key: 'agents', count: 0, errors: 0 },
      ])
      expect(summary.topDestinations.map((destination) => destination.name)).toEqual(['bakin_exec_tasks_list'])

      const feed = getUsageFeed({ window: '1h', includeRoutine: true })
      expect(feed.totals).toEqual({ count: 1, errors: 0, errorRate: 0 })
      expect(feed.recent.map((entry) => entry.name)).toEqual(['bakin_exec_tasks_list'])

      // The transport remains in the raw recorder for REST watchdogs.
      expect(getUsageStats({ kind: 'rest', window: '1h', includeRoutine: true })).toEqual({ total: 1, errors: 0 })
      expect(getStatsByMs({ kind: 'rest', windowMs: WINDOW_MS['1h'], includeRoutine: true })).toEqual({ total: 1, errors: 0 })
    })

    it('excludes a successful routine MCP tool and its HTTP transport from the summary', () => {
      seed({
        kind: 'mcp',
        activityClass: 'routine',
        name: 'bakin_exec_heartbeat',
        status: 'ok',
      })
      seed({
        kind: 'rest',
        activityClass: 'user',
        name: '/mcp',
        status: 'ok',
        meta: { method: 'POST', httpStatus: 200 },
      })

      const summary = getInteractionSummary({ window: '1h' })

      expect(summary.totals).toEqual({ count: 0, errors: 0, unverified: 0, foreground: 0, background: 0 })
      expect(summary.categories).toContainEqual({ key: 'tools', count: 0, errors: 0 })
      expect(summary.categories).toContainEqual({ key: 'api', count: 0, errors: 0 })
      expect(getUsageFeed({ window: '1h' }).totals.count).toBe(0)

      const completeFeed = getUsageFeed({ window: '1h', includeRoutine: true })
      expect(completeFeed.totals.count).toBe(1)
      expect(completeFeed.recent[0]).toMatchObject({
        kind: 'mcp',
        name: 'bakin_exec_heartbeat',
        activityClass: 'routine',
      })

      // The foreground transport stays available to raw REST health checks.
      expect(getStatsByMs({ kind: 'rest', windowMs: WINDOW_MS['1h'], includeRoutine: true })).toEqual({ total: 1, errors: 0 })
    })

    it('keeps a failed MCP transport visible when no logical tool interaction was recorded', () => {
      seed({
        kind: 'rest',
        activityClass: 'user',
        name: '/mcp',
        status: 'error',
        meta: { method: 'POST', httpStatus: 503 },
      })

      const summary = getInteractionSummary({ window: '1h' })

      expect(summary.totals).toEqual({ count: 1, errors: 1, unverified: 0, foreground: 1, background: 0 })
      expect(summary.categories).toContainEqual({ key: 'api', count: 1, errors: 1 })
      expect(summary.topDestinations).toContainEqual({
        category: 'api',
        name: '/mcp',
        count: 1,
        errors: 1,
        medianDurationMs: 10,
      })

      const feed = getUsageFeed({ window: '1h' })
      expect(feed.totals).toEqual({ count: 1, errors: 1, errorRate: 1 })
      expect(feed.recent[0]).toMatchObject({ kind: 'rest', name: '/mcp', status: 'error' })
    })

    it('excludes successful routine rows while keeping system work and routine failures', () => {
      for (let call = 0; call < 9; call++) {
        seed({ kind: 'mcp', activityClass: 'routine', name: 'health_poll', status: 'ok', durationMs: 5 })
      }
      seed({ kind: 'mcp', activityClass: 'routine', name: 'health_poll', status: 'error', durationMs: 90 })
      seed({ kind: 'rest', activityClass: 'system', name: '/api/plugin-assets', status: 'ok', durationMs: 4 })
      seed({ kind: 'mcp', activityClass: 'user', name: 'bakin_exec_tasks_list', status: 'ok', durationMs: 10 })
      seed({ kind: 'mcp', activityClass: 'user', name: 'bakin_exec_tasks_list', status: 'ok', durationMs: 30 })

      const summary = getInteractionSummary({ window: '1h' })

      expect(summary.totals).toEqual({ count: 4, errors: 1, unverified: 0, foreground: 2, background: 2 })
      expect(summary.categories).toContainEqual({ key: 'tools', count: 3, errors: 1 })
      expect(summary.categories).toContainEqual({ key: 'api', count: 1, errors: 0 })
      expect(summary.topDestinations).toContainEqual({
        category: 'tools',
        name: 'health_poll',
        count: 1,
        errors: 1,
        medianDurationMs: 90,
      })
      expect(summary.topDestinations).toContainEqual({
        category: 'tools',
        name: 'bakin_exec_tasks_list',
        count: 2,
        errors: 0,
        medianDurationMs: 20,
      })
      expect(summary.topDestinations).toContainEqual({
        category: 'api',
        name: '/api/plugin-assets',
        count: 1,
        errors: 0,
        medianDurationMs: 4,
      })
    })

    it('keeps a failed destination in the capped ranking even when successful traffic is busier', () => {
      for (let destination = 0; destination < 10; destination++) {
        seed({ kind: 'rest', activityClass: 'user', name: `busy-${destination}`, status: 'ok' })
        seed({ kind: 'rest', activityClass: 'user', name: `busy-${destination}`, status: 'ok' })
      }
      seed({ kind: 'mcp', activityClass: 'user', name: 'web_search', status: 'error' })

      const summary = getInteractionSummary({ window: '1h' })

      expect(summary.topDestinations).toHaveLength(10)
      expect(summary.topDestinations).toContainEqual({
        category: 'tools',
        name: 'web_search',
        count: 1,
        errors: 1,
        medianDurationMs: 10,
      })
    })

    it('treats REST 4xx responses as failed interactions without changing recorder watchdog semantics', () => {
      seed({
        kind: 'rest',
        name: '/api/plugins/health/missing',
        agent: null,
        status: 'ok',
        meta: { httpStatus: 404, method: 'GET' },
      })

      const summary = getInteractionSummary({ window: '1h' })

      expect(summary.totals.errors).toBe(1)
      expect(summary.categories).toContainEqual({ key: 'api', count: 1, errors: 1 })
      expect(summary.topDestinations).toContainEqual({
        category: 'api',
        name: '/api/plugins/health/missing',
        count: 1,
        errors: 1,
        medianDurationMs: 10,
      })
      expect(summary.timeBuckets.reduce((total, bucket) => total + bucket.failureCount, 0)).toBe(1)
      const activityFeed = getUsageFeed({ kind: 'rest', window: '1h' })
      expect(activityFeed.totals).toEqual({ count: 1, errors: 1, errorRate: 1 })
      expect(activityFeed.recent[0]?.status).toBe('error')
      expect(getUsageStats({ kind: 'rest', window: '1h' })).toEqual({ total: 1, errors: 0 })
    })

    it('counts completed tools whose result was not observed as unverified, not failed', () => {
      seed({
        kind: 'mcp',
        activityClass: 'user',
        status: 'ok',
        meta: { resultMissing: true, turnTerminalStatus: 'completed' },
      })
      seed({
        kind: 'mcp',
        activityClass: 'user',
        status: 'ok',
        meta: { resultMissing: true, turnTerminalStatus: 'aborted' },
      })
      seed({
        kind: 'mcp',
        activityClass: 'routine',
        status: 'ok',
        meta: { resultMissing: true, turnTerminalStatus: 'completed' },
      })

      const summary = getInteractionSummary({ window: '1h' })

      expect(summary.totals).toEqual({
        count: 3,
        errors: 0,
        unverified: 2,
        foreground: 2,
        background: 1,
      })
      expect(summary.categories).toContainEqual({ key: 'tools', count: 3, errors: 0 })
    })
  })

  describe('window filter', () => {
    it('excludes entries older than the window', () => {
      const old = new Date(Date.now() - WINDOW_MS['1h'] - 1000).toISOString()
      const fresh = new Date(Date.now() - 1000).toISOString()
      recordUsage({ kind: 'mcp', activityClass: 'user', name: 'old', agent: 'a', durationMs: 1, status: 'ok', ts: old })
      recordUsage({ kind: 'mcp', activityClass: 'user', name: 'fresh', agent: 'a', durationMs: 1, status: 'ok', ts: fresh })
      const feed5m = getUsageFeed({ kind: 'mcp', window: '5m' })
      expect(feed5m.totals.count).toBe(1)
      expect(feed5m.recent[0].name).toBe('fresh')
      const feed1h = getUsageFeed({ kind: 'mcp', window: '1h' })
      expect(feed1h.totals.count).toBe(1)
      const feed24h = getUsageFeed({ kind: 'mcp', window: '24h' })
      expect(feed24h.totals.count).toBe(2)
    })

    it('excludes future-dated entries instead of clamping them into the latest bucket', () => {
      setSystemTime(new Date('2026-07-13T12:00:00.000Z'))
      try {
        seed({
          ts: '2026-07-13T12:01:00.000Z',
          status: 'error',
        })

        const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
        expect(feed.totals).toEqual({ count: 0, errors: 0, errorRate: 0 })
        expect(feed.timeBuckets.every((bucket) => bucket.count === 0)).toBe(true)
        expect(getUsageStats({ kind: 'mcp', window: '5m' })).toEqual({ total: 0, errors: 0 })
        expect(getStatsByMs({ kind: 'mcp', windowMs: WINDOW_MS['5m'] })).toEqual({ total: 0, errors: 0 })
        expect(getErrorCount(WINDOW_MS['5m']).total).toBe(0)
      } finally {
        setSystemTime()
      }
    })
  })

  describe('kind filter', () => {
    it('narrows to one kind', () => {
      seed({ kind: 'mcp', name: 'm' })
      seed({ kind: 'rest', name: 'r' })
      seed({ kind: 'agent', name: 'a' })
      expect(getUsageFeed({ kind: 'mcp', window: '5m' }).totals.count).toBe(1)
      expect(getUsageFeed({ kind: 'rest', window: '5m' }).totals.count).toBe(1)
      expect(getUsageFeed({ kind: 'agent', window: '5m' }).totals.count).toBe(1)
    })

    it('returns all kinds when kind is omitted', () => {
      seed({ kind: 'mcp' })
      seed({ kind: 'rest' })
      seed({ kind: 'agent' })
      expect(getUsageFeed({ window: '5m' }).totals.count).toBe(3)
    })
  })

  describe('agent filter', () => {
    it('narrows to one agent', () => {
      seed({ agent: 'alice' })
      seed({ agent: 'bob' })
      seed({ agent: 'alice' })
      const feed = getUsageFeed({ kind: 'mcp', window: '5m', agent: 'alice' })
      expect(feed.totals.count).toBe(2)
    })
  })

  describe('topByName', () => {
    it('keeps exact destination signatures separate', () => {
      const now = Date.now()
      seed({ kind: 'mcp', name: 'shared.destination', durationMs: 10 })
      seed({
        kind: 'mcp', name: 'shared.destination', durationMs: 20, status: 'error',
        ts: new Date(now - 30_000).toISOString(),
      })
      seed({
        kind: 'mcp', name: 'shared.destination', durationMs: 30, status: 'error',
        ts: new Date(now - 20_000).toISOString(),
      })
      seed({
        kind: 'rest', name: 'shared.destination', durationMs: 40,
        meta: { method: 'GET' },
      })
      seed({
        kind: 'rest', name: 'shared.destination', durationMs: 60, status: 'error',
        ts: new Date(now - 15_000).toISOString(), meta: { method: 'GET' },
      })
      seed({
        kind: 'rest', name: 'shared.destination', durationMs: 80,
        meta: { method: 'POST' },
      })
      seed({
        kind: 'rest', name: 'shared.destination', durationMs: 100, status: 'error',
        ts: new Date(now - 10_000).toISOString(), meta: { method: 'POST' },
      })

      const rows = getUsageFeed({ window: '5m' }).topByName
        .filter((row) => row.name === 'shared.destination')

      expect(rows).toHaveLength(3)
      expect(rows).toEqual(expect.arrayContaining([
        {
          kind: 'mcp', method: null, name: 'shared.destination', count: 3, errors: 2,
          medianDurationMs: 20,
        },
        {
          kind: 'rest', method: 'POST', name: 'shared.destination', count: 2, errors: 1,
          medianDurationMs: 90,
        },
        {
          kind: 'rest', method: 'GET', name: 'shared.destination', count: 2, errors: 1,
          medianDurationMs: 50,
        },
      ]))
    })

    it('sorts by count desc and caps at 10', () => {
      for (let i = 0; i < 12; i++) {
        for (let j = 0; j <= i; j++) seed({ name: `tool_${i}` })
      }
      const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
      expect(feed.topByName).toHaveLength(10)
      expect(feed.topByName[0].name).toBe('tool_11')
      expect(feed.topByName[0].count).toBe(12)
      expect(feed.topByName[9].name).toBe('tool_2')
    })

    it('computes median duration', () => {
      seed({ name: 'x', durationMs: 10 })
      seed({ name: 'x', durationMs: 20 })
      seed({ name: 'x', durationMs: 30 })
      const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
      expect(feed.topByName[0].medianDurationMs).toBe(20)
    })

    it('returns null median when all entries have null duration', () => {
      seed({ name: 'x', durationMs: null })
      seed({ name: 'x', durationMs: null })
      const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
      expect(feed.topByName[0].medianDurationMs).toBeNull()
    })
  })

  describe('byAgent', () => {
    it('groups by agent and includes lastActivity', () => {
      const t1 = new Date(Date.now() - 5000).toISOString()
      const t2 = new Date(Date.now() - 1000).toISOString()
      recordUsage({ kind: 'mcp', activityClass: 'user', name: 'a', agent: 'alice', durationMs: 1, status: 'ok', ts: t1 })
      recordUsage({ kind: 'mcp', activityClass: 'user', name: 'b', agent: 'alice', durationMs: 1, status: 'ok', ts: t2 })
      const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
      const alice = feed.byAgent.find(x => x.agent === 'alice')
      expect(alice).toBeDefined()
      expect(alice!.count).toBe(2)
      expect(alice!.lastActivity?.name).toBe('b')
    })

    it('buckets null agent as "unknown"', () => {
      recordUsage({ kind: 'rest', activityClass: 'user', name: 'r', agent: null, durationMs: 1, status: 'ok' })
      const feed = getUsageFeed({ kind: 'rest', window: '5m' })
      expect(feed.byAgent[0].agent).toBe('unknown')
    })
  })

  describe('recent ordering', () => {
    it('returns newest first, capped at 50', () => {
      for (let i = 0; i < 60; i++) {
        const ts = new Date(Date.now() - (60 - i) * 100).toISOString()
        recordUsage({ kind: 'mcp', activityClass: 'user', name: `t${i}`, agent: 'a', durationMs: 1, status: 'ok', ts })
      }
      const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
      expect(feed.recent).toHaveLength(50)
      expect(feed.recent[0].name).toBe('t59')
      expect(feed.recent[49].name).toBe('t10')
    })
  })

  describe('ring buffer eviction', () => {
    it('evicts oldest and reports partial coverage when rows inside the window were lost', () => {
      setSystemTime(new Date('2026-07-13T12:00:00.000Z'))
      const uptime = spyOn(process, 'uptime').mockReturnValue(2 * 60 * 60)
      try {
        for (let i = 0; i < 10_100; i++) seed({ name: `t${i}` })

        expect(getEntryCount()).toBe(10_000)
        expect(getInteractionSummary({ window: '1h' }).coverage).toEqual({
          startsAt: '2026-07-13T12:00:00.000Z',
          hasFullWindow: false,
          reason: 'buffer_limit',
        })
      } finally {
        uptime.mockRestore()
        setSystemTime()
      }
    })
  })

  describe('getUsageStats', () => {
    it('returns total and error counts for a window', () => {
      seed({ status: 'ok' })
      seed({ status: 'error' })
      seed({ status: 'error' })
      const stats = getUsageStats({ kind: 'mcp', window: '5m' })
      expect(stats.total).toBe(3)
      expect(stats.errors).toBe(2)
    })

    it('excludes successful routine work from named and raw-window stats unless opted in', () => {
      seed({ activityClass: 'user', status: 'ok' })
      seed({ activityClass: 'routine', status: 'ok' })
      seed({ activityClass: 'routine', status: 'error' })

      expect(getUsageStats({ kind: 'mcp', window: '5m' })).toEqual({ total: 2, errors: 1 })
      expect(getUsageStats({ kind: 'mcp', window: '5m', includeRoutine: true })).toEqual({ total: 3, errors: 1 })
      expect(getStatsByMs({ kind: 'mcp', windowMs: WINDOW_MS['5m'] })).toEqual({ total: 2, errors: 1 })
      expect(getStatsByMs({ kind: 'mcp', windowMs: WINDOW_MS['5m'], includeRoutine: true })).toEqual({ total: 3, errors: 1 })
    })
  })

  describe('getErrorCount', () => {
    it('counts errors by kind within a window', () => {
      seed({ kind: 'mcp', status: 'error' })
      seed({ kind: 'mcp', status: 'error' })
      seed({ kind: 'rest', status: 'error' })
      seed({ kind: 'agent', status: 'ok' })
      const ec = getErrorCount(WINDOW_MS['5m'])
      expect(ec.total).toBe(3)
      expect(ec.byKind).toEqual({ mcp: 2, rest: 1, agent: 0 })
    })

    it('ignores entries older than the window', () => {
      const old = new Date(Date.now() - WINDOW_MS['1h'] - 1000).toISOString()
      recordUsage({ kind: 'mcp', activityClass: 'user', name: 'x', agent: 'a', durationMs: 1, status: 'error', ts: old })
      const ec = getErrorCount(WINDOW_MS['5m'])
      expect(ec.total).toBe(0)
    })

    it('uses the same projected REST outcome shown by the interaction feed', () => {
      recordUsage({
        kind: 'rest',
        activityClass: 'routine',
        name: '/api/plugins/health/missing',
        agent: null,
        durationMs: 5,
        status: 'ok',
        meta: { httpStatus: 404 },
      })
      recordUsage({
        kind: 'rest',
        activityClass: 'routine',
        name: '/api/plugins/health/summary',
        agent: null,
        durationMs: 5,
        status: 'ok',
        meta: { httpStatus: 200 },
      })

      expect(getErrorCount(WINDOW_MS['5m'])).toEqual({
        total: 1,
        byKind: { mcp: 0, rest: 1, agent: 0 },
      })
    })
  })

  describe('getCurrentAgentActivity', () => {
    it('returns the most recent entry per agent', () => {
      const t1 = new Date(Date.now() - 5000).toISOString()
      const t2 = new Date(Date.now() - 1000).toISOString()
      recordUsage({ kind: 'mcp', activityClass: 'user', name: 'old', agent: 'alice', durationMs: 1, status: 'ok', ts: t1 })
      recordUsage({ kind: 'mcp', activityClass: 'user', name: 'new', agent: 'alice', durationMs: 1, status: 'ok', ts: t2 })
      recordUsage({ kind: 'mcp', activityClass: 'user', name: 'only', agent: 'bob', durationMs: 1, status: 'ok', ts: t1 })
      const activity = getCurrentAgentActivity()
      expect(activity).toHaveLength(2)
      const alice = activity.find(a => a.agent === 'alice')!
      expect(alice.latest.name).toBe('new')
      expect(alice.idleSec).toBeLessThan(5)
    })

    it('ignores entries with null agent', () => {
      recordUsage({ kind: 'rest', activityClass: 'user', name: 'r', agent: null, durationMs: 1, status: 'ok' })
      expect(getCurrentAgentActivity()).toHaveLength(0)
    })
  })

  describe('isAgentIdle', () => {
    it('returns true at or above 30 seconds', () => {
      expect(isAgentIdle(29)).toBe(false)
      expect(isAgentIdle(30)).toBe(true)
      expect(isAgentIdle(100)).toBe(true)
    })
  })
})
