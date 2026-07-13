import { describe, it, expect, beforeEach, mock, setSystemTime } from 'bun:test'
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

describe('usage recorder', () => {
  beforeEach(() => clearUsage())

  describe('recordUsage + getUsageFeed basics', () => {
    it('records an entry and retrieves it in the feed', () => {
      seed({ name: 'tool_a' })
      const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
      expect(feed.totals.count).toBe(1)
      expect(feed.topByName[0]).toMatchObject({ name: 'tool_a', count: 1, errors: 0 })
      expect(feed.recent).toHaveLength(1)
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
      seed({ name: 'poll-failed', activityClass: 'routine', status: 'error' })

      const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
      expect(feed.totals).toMatchObject({ count: 3, errors: 1 })
      expect(feed.recent.map((entry) => entry.name).sort()).toEqual([
        'background',
        'foreground',
        'poll-failed',
      ])
      expect(feed.recent.find((entry) => entry.name === 'poll-failed')?.activityClass).toBe('routine')
    })

    it('includes successful routine entries only when includeRoutine is explicit', () => {
      seed({ name: 'poll-ok', activityClass: 'routine', status: 'ok' })
      seed({ name: 'poll-failed', activityClass: 'routine', status: 'error' })

      const feed = getUsageFeed({ kind: 'mcp', window: '5m', includeRoutine: true })
      expect(feed.totals).toMatchObject({ count: 2, errors: 1 })
      expect(feed.recent.map((entry) => entry.name).sort()).toEqual(['poll-failed', 'poll-ok'])
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

    it('auto-stamps ts if not provided', () => {
      seed()
      const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
      expect(() => new Date(feed.recent[0].ts)).not.toThrow()
      expect(new Date(feed.recent[0].ts).getTime()).toBeGreaterThan(0)
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
    it('evicts oldest when over MAX_ENTRIES', () => {
      for (let i = 0; i < 10_100; i++) seed({ name: `t${i}` })
      expect(getEntryCount()).toBe(10_000)
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
