import { describe, it, expect, beforeEach, vi } from 'vitest'

// Need fresh module state per test since state is module-level
let recordRequest: typeof import('../../src/core/request-log').recordRequest
let getRequestStats: typeof import('../../src/core/request-log').getRequestStats

describe('request-log', () => {
  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../../src/core/request-log')
    recordRequest = mod.recordRequest
    getRequestStats = mod.getRequestStats
  })

  // -------------------------------------------------------------------------
  // recordRequest
  // -------------------------------------------------------------------------

  describe('recordRequest', () => {
    it('increments totalRequests', () => {
      recordRequest({ ts: '2026-01-01T00:00:00Z', method: 'GET', path: '/api/tasks', status: 200, durationMs: 10 })
      const stats = getRequestStats()
      expect(stats.totalRequests).toBe(1)
    })

    it('increments totalErrors for status >= 400', () => {
      recordRequest({ ts: '2026-01-01T00:00:00Z', method: 'GET', path: '/api/bad', status: 404, durationMs: 5 })
      recordRequest({ ts: '2026-01-01T00:00:00Z', method: 'POST', path: '/api/err', status: 500, durationMs: 5 })
      const stats = getRequestStats()
      expect(stats.totalErrors).toBe(2)
    })

    it('does not count status < 400 as errors', () => {
      recordRequest({ ts: '2026-01-01T00:00:00Z', method: 'GET', path: '/api/ok', status: 200, durationMs: 5 })
      recordRequest({ ts: '2026-01-01T00:00:00Z', method: 'GET', path: '/api/redir', status: 301, durationMs: 5 })
      const stats = getRequestStats()
      expect(stats.totalErrors).toBe(0)
    })

    it('tracks per-endpoint stats', () => {
      recordRequest({ ts: '2026-01-01T00:00:00Z', method: 'GET', path: '/api/tasks', status: 200, durationMs: 10 })
      recordRequest({ ts: '2026-01-01T00:01:00Z', method: 'GET', path: '/api/tasks', status: 200, durationMs: 15 })

      const stats = getRequestStats()
      const endpoint = stats.endpoints.find(e => e.endpoint === 'GET /api/tasks')
      expect(endpoint).toBeDefined()
      expect(endpoint!.count).toBe(2)
      expect(endpoint!.lastCalled).toBe('2026-01-01T00:01:00Z')
    })

    it('tracks errors per endpoint', () => {
      recordRequest({ ts: '2026-01-01T00:00:00Z', method: 'POST', path: '/api/tasks', status: 200, durationMs: 10 })
      recordRequest({ ts: '2026-01-01T00:00:00Z', method: 'POST', path: '/api/tasks', status: 422, durationMs: 10 })

      const stats = getRequestStats()
      const endpoint = stats.endpoints.find(e => e.endpoint === 'POST /api/tasks')
      expect(endpoint!.errors).toBe(1)
    })

    it('caps recent entries at 200 (ring buffer)', () => {
      for (let i = 0; i < 210; i++) {
        recordRequest({ ts: `ts-${i}`, method: 'GET', path: '/api/x', status: 200, durationMs: 1 })
      }
      // getRequestStats returns last 50 of the 200 buffer
      const stats = getRequestStats()
      expect(stats.totalRequests).toBe(210)
      // recent should be at most 50
      expect(stats.recent.length).toBeLessThanOrEqual(50)
    })
  })

  // -------------------------------------------------------------------------
  // getRequestStats
  // -------------------------------------------------------------------------

  describe('getRequestStats', () => {
    it('returns empty state initially', () => {
      const stats = getRequestStats()
      expect(stats.totalRequests).toBe(0)
      expect(stats.totalErrors).toBe(0)
      expect(stats.endpoints).toEqual([])
      expect(stats.recent).toEqual([])
      expect(stats.upSince).toBeDefined()
    })

    it('sorts endpoints by count descending', () => {
      recordRequest({ ts: 't1', method: 'GET', path: '/a', status: 200, durationMs: 1 })
      recordRequest({ ts: 't2', method: 'GET', path: '/b', status: 200, durationMs: 1 })
      recordRequest({ ts: 't3', method: 'GET', path: '/b', status: 200, durationMs: 1 })
      recordRequest({ ts: 't4', method: 'GET', path: '/b', status: 200, durationMs: 1 })

      const stats = getRequestStats()
      expect(stats.endpoints[0].endpoint).toBe('GET /b')
      expect(stats.endpoints[0].count).toBe(3)
      expect(stats.endpoints[1].endpoint).toBe('GET /a')
    })

    it('returns recent entries in reverse order (most recent first)', () => {
      recordRequest({ ts: 'first', method: 'GET', path: '/a', status: 200, durationMs: 1 })
      recordRequest({ ts: 'second', method: 'GET', path: '/b', status: 200, durationMs: 1 })

      const stats = getRequestStats()
      expect(stats.recent[0].ts).toBe('second')
      expect(stats.recent[1].ts).toBe('first')
    })

    it('limits recent to 50 entries', () => {
      for (let i = 0; i < 100; i++) {
        recordRequest({ ts: `ts-${i}`, method: 'GET', path: '/x', status: 200, durationMs: 1 })
      }
      const stats = getRequestStats()
      expect(stats.recent).toHaveLength(50)
    })
  })
})
