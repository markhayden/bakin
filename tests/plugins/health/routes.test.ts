/**
 * Tests for health plugin routes and exec tools.
 * Covers all API routes and both bakin_exec_health_* tools.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ActivatedPlugin } from '../test-helpers'

// ---------------------------------------------------------------------------
// Temp directory
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `bakin-test-health-routes-${Date.now()}`)

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../../src/core/settings', () => ({
  getSettings: vi.fn(() => ({
    openclaw: { binaryPath: 'openclaw', gatewayUrl: 'http://127.0.0.1', gatewayPort: 18789 },
  })),
}))

const mockRequestStats = {
  totalRequests: 42,
  totalErrors: 2,
  upSince: '2026-04-01T00:00:00Z',
  endpoints: [],
  recent: [],
}

vi.mock('../../../src/core/request-log', () => ({
  getRequestStats: () => mockRequestStats,
  getRecentStatsForPathPrefix: () => ({ total: 0, errors: 0 }),
  getRestStatsByPlugin: () => ({
    windowSec: 0,
    total: 0,
    errors: 0,
    successRate: 1,
    byPlugin: [],
  }),
}))

const mockDoctorResults = [
  { check: 'gateway', status: 'ok', message: 'Gateway responding' },
  { check: 'taskboard', status: 'warn', message: 'Missing columns' },
  { check: 'agents', status: 'error', message: 'Roster mismatch' },
]

vi.mock('../../../src/core/doctor', () => ({
  getLastResults: vi.fn(() => ({
    results: mockDoctorResults,
    timestamp: Date.now(),
  })),
  runDiagnostics: vi.fn(async () => mockDoctorResults),
}))

vi.mock('../../../src/core/agent-usage', () => ({
  getAllAgentUsage: () => [
    { agent: 'patch', sessionId: 's1', model: 'claude-4', messages: 10, tokens: { total: 1000 }, cost: { total: 0.05 } },
  ],
}))

vi.mock('../../../src/core/search-registry', () => ({
  getSearchHealth: vi.fn(async () => ({
    enabled: false,
    tables: [],
  })),
}))

// Defensive stub — the test isolation hook scans for plugin refs in text and
// flags any mention of plugins/tasks even though we never import the module.
// The strings /api/plugins/tasks/* in usage-feed assertions trip the scanner.
vi.mock('../../../plugins/tasks/lib/flow-store', () => ({}))

// Mock globalThis registry accessors
;(globalThis as any).__bakinGetRegistrySnapshot = () => [
  { id: 'tasks', name: 'Tasks', version: '1.0.0', description: 'Task management', source: 'built-in', routes: 5 },
  { id: 'health', name: 'Health', version: '1.0.0', description: 'System health', source: 'built-in', routes: 5 },
]
;(globalThis as any).__bakinGetExecToolStats = () => [
  { name: 'bakin_exec_tasks_list', source: 'tasks', calls: 12, lastUsed: '2026-04-01T10:00:00Z' },
  { name: 'bakin_exec_health_status', source: 'health', calls: 0, lastUsed: null },
]

// Mock fetch for MCP stats
const mockFetch = vi.fn(async (url: string) => {
  if (url.includes('/mcp/stats')) {
    return {
      json: async () => ({
        activeSessions: [{ agent: 'patch', sessions: 1, toolCalls: 5, connectedAt: '2026-04-01T10:00:00Z' }],
        toolCallCounts: { bakin_exec_tasks_list: 5 },
        totalRequests: 10,
        upSince: '2026-04-01T00:00:00Z',
      }),
    }
  }
  throw new Error(`unexpected fetch: ${url}`)
})
vi.stubGlobal('fetch', mockFetch)

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { activatePlugin, findRoute, findTool, callRoute, callTool, makeRequest } from '../test-helpers'
import healthPlugin from '../../../plugins/health'
import { recordUsage, clearUsage } from '../../../src/core/usage'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let activated: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  activated = await activatePlugin(healthPlugin, testDir)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Route tests
// ---------------------------------------------------------------------------

describe('Health Plugin Routes', () => {
  it('registers 7 routes', () => {
    expect(activated.routes.length).toBe(7)
  })

  it('registers 2 exec tools', () => {
    expect(activated.execTools.length).toBe(2)
    expect(activated.execTools.map(t => t.name).sort()).toEqual([
      'bakin_exec_health_doctor',
      'bakin_exec_health_status',
    ])
  })

  describe('GET /summary', () => {
    it('returns aggregated health data', async () => {
      const route = findRoute(activated.routes, 'GET', '/summary')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, activated.ctx)
      expect(status).toBe(200)
      expect(body.doctor).toBeDefined()
      expect(body.requests).toBeDefined()
      expect(body.server).toBeDefined()
      expect(body.openclawPort).toBe(18789)
    })

    it('includes server memory info', async () => {
      const route = findRoute(activated.routes, 'GET', '/summary')!
      const { body } = await callRoute(route, activated.ctx)
      const server = body.server as Record<string, unknown>
      expect(server.memoryMB).toBeTypeOf('number')
      expect(server.totalMemoryMB).toBeTypeOf('number')
      expect((server.totalMemoryMB as number)).toBeGreaterThan(0)
    })

    it('includes doctor summary with error/warning counts', async () => {
      const route = findRoute(activated.routes, 'GET', '/summary')!
      const { body } = await callRoute(route, activated.ctx)
      const doctor = body.doctor as Record<string, unknown>
      const summary = doctor.summary as Record<string, number>
      expect(summary.total).toBe(3)
      expect(summary.errors).toBe(1)
      expect(summary.warnings).toBe(1)
    })
  })

  describe('GET /requests', () => {
    it('returns request stats', async () => {
      const route = findRoute(activated.routes, 'GET', '/requests')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, activated.ctx)
      expect(status).toBe(200)
      expect(body.totalRequests).toBe(42)
      expect(body.totalErrors).toBe(2)
    })
  })

  describe('GET /usage', () => {
    it('returns agent usage data', async () => {
      const route = findRoute(activated.routes, 'GET', '/usage')!
      expect(route).toBeDefined()

      const res = await route.handler(makeRequest('/usage'), activated.ctx)
      const body = await res.json()
      expect(Array.isArray(body)).toBe(true)
      expect(body[0].agent).toBe('patch')
    })
  })

  describe('GET /registry', () => {
    it('returns plugins and exec tools', async () => {
      const route = findRoute(activated.routes, 'GET', '/registry')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, activated.ctx)
      expect(status).toBe(200)
      expect(Array.isArray(body.plugins)).toBe(true)
      expect(Array.isArray(body.execTools)).toBe(true)
      expect((body.plugins as unknown[]).length).toBe(2)
    })
  })

  describe('GET /summary errors1h', () => {
    it('includes errors1h sourced from the real recorder', async () => {
      clearUsage()
      recordUsage({ kind: 'mcp', name: 't1', agent: 'a', durationMs: 5, status: 'error' })
      recordUsage({ kind: 'mcp', name: 't2', agent: 'a', durationMs: 5, status: 'error' })
      recordUsage({ kind: 'rest', name: '/api/x', agent: null, durationMs: 5, status: 'error' })
      recordUsage({ kind: 'agent', name: 'dispatch', agent: 'a', durationMs: null, status: 'ok' })

      const route = findRoute(activated.routes, 'GET', '/summary')!
      const { body } = await callRoute(route, activated.ctx)
      expect(body.errors1h).toEqual({
        total: 3,
        byKind: { mcp: 2, rest: 1, agent: 0 },
      })
      clearUsage()
    })
  })

  describe('GET /usage-feed', () => {
    it('returns usage entries from the real recorder', async () => {
      clearUsage()
      recordUsage({ kind: 'mcp', name: 'bakin_exec_tasks_list', agent: 'roscoe', durationMs: 12, status: 'ok' })
      recordUsage({ kind: 'mcp', name: 'bakin_exec_tasks_list', agent: 'roscoe', durationMs: 8, status: 'ok' })
      recordUsage({ kind: 'rest', name: '/api/plugins/tasks/list', agent: null, durationMs: 20, status: 'ok' })

      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, activated.ctx, {
        searchParams: { kind: 'mcp', window: '1h' },
      })
      expect(status).toBe(200)
      const totals = (body as { totals: { count: number } }).totals
      const topByName = (body as { topByName: Array<{ name: string; count: number }> }).topByName
      expect(totals.count).toBe(2)
      expect(topByName[0].name).toBe('bakin_exec_tasks_list')
      expect(topByName[0].count).toBe(2)
      clearUsage()
    })

    it('defaults window to 1h when omitted', async () => {
      clearUsage()
      recordUsage({ kind: 'agent', name: 'heartbeat', agent: 'roscoe', durationMs: null, status: 'ok' })
      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      const { status, body } = await callRoute(route, activated.ctx)
      expect(status).toBe(200)
      expect((body as { totals: { count: number } }).totals.count).toBe(1)
      clearUsage()
    })

    it('filters by agent', async () => {
      clearUsage()
      recordUsage({ kind: 'mcp', name: 'x', agent: 'alice', durationMs: 1, status: 'ok' })
      recordUsage({ kind: 'mcp', name: 'x', agent: 'bob', durationMs: 1, status: 'ok' })
      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      const { body } = await callRoute(route, activated.ctx, {
        searchParams: { window: '1h', agent: 'alice' },
      })
      expect((body as { totals: { count: number } }).totals.count).toBe(1)
      clearUsage()
    })

    it('rejects invalid kind with 400', async () => {
      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      const { status, body } = await callRoute(route, activated.ctx, {
        searchParams: { kind: 'bogus', window: '1h' },
      })
      expect(status).toBe(400)
      expect(body.error).toBe('Invalid query')
    })

    it('rejects invalid window with 400', async () => {
      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      const { status, body } = await callRoute(route, activated.ctx, {
        searchParams: { window: '99y' },
      })
      expect(status).toBe(400)
    })
  })

  describe('GET /doctor', () => {
    it('returns cached results by default', async () => {
      const route = findRoute(activated.routes, 'GET', '/doctor')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, activated.ctx)
      expect(status).toBe(200)
      expect(body.cachedAt).toBeDefined()
      const summary = body.summary as Record<string, number>
      expect(summary.total).toBe(3)
      expect(summary.errors).toBe(1)
    })

    it('runs fresh diagnostics when ?fresh=true', async () => {
      const { runDiagnostics } = await import('../../../src/core/doctor')
      const route = findRoute(activated.routes, 'GET', '/doctor')!

      const { status, body } = await callRoute(route, activated.ctx, {
        searchParams: { fresh: 'true' },
      })
      expect(status).toBe(200)
      expect(body.cachedAt).toBeDefined()
      expect(runDiagnostics).toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// Exec tool tests
// ---------------------------------------------------------------------------

describe('Health Exec Tools', () => {
  describe('bakin_exec_health_status', () => {
    it('returns system health summary', async () => {
      const tool = findTool(activated.execTools, 'bakin_exec_health_status')!
      expect(tool).toBeDefined()

      const result = await callTool(tool, {})
      expect(result.ok).toBe(true)
      expect(result.memoryMB).toBeTypeOf('number')
      expect(result.totalMemoryMB).toBeTypeOf('number')
      expect(result.memoryPercent).toBeTypeOf('number')
      expect(result.activeSessions).toBe(1)
      expect(result.apiRequests).toBe(42)
      expect(result.doctorErrors).toBe(1)
      expect(result.doctorWarnings).toBe(1)
    })
  })

  describe('bakin_exec_health_doctor', () => {
    it('returns cached results when fresh is not set', async () => {
      const tool = findTool(activated.execTools, 'bakin_exec_health_doctor')!
      expect(tool).toBeDefined()

      const result = await callTool(tool, {})
      expect(result.ok).toBe(true)
      expect(result.cachedAt).toBeDefined()
      const summary = result.summary as Record<string, number>
      expect(summary.errors).toBe(1)
    })

    it('runs fresh diagnostics when fresh=true', async () => {
      const { runDiagnostics } = await import('../../../src/core/doctor')
      const tool = findTool(activated.execTools, 'bakin_exec_health_doctor')!

      const result = await callTool(tool, { fresh: true })
      expect(result.ok).toBe(true)
      expect(result.cachedAt).toBeDefined()
      expect(runDiagnostics).toHaveBeenCalled()
    })
  })
})
