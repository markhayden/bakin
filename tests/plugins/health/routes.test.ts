/**
 * Tests for health plugin routes and exec tools.
 *
 * These tests exercise the unified usage recorder directly — they seed
 * `recordUsage()` entries and assert the routes derive their responses
 * from the same state the real server uses. The previous version of this
 * file mocked every stat source and passed even when the wiring was
 * broken; that is the failure mode the overhaul is meant to prevent.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ActivatedPlugin } from '../test-helpers'

const testDir = join(tmpdir(), `bakin-test-health-routes-${Date.now()}`)

// ES imports are hoisted above mock.module — set env so the guards don't trip.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + '-openclaw'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../../src/core/settings', () => ({
  getSettings: mock(() => ({
    openclaw: { binaryPath: 'openclaw', gatewayUrl: 'http://127.0.0.1', gatewayPort: 18789 },
  })),
}))

const mockDoctorResults = [
  { check: 'gateway', status: 'ok', message: 'Gateway responding' },
  { check: 'taskboard', status: 'warn', message: 'Missing columns' },
  { check: 'agents', status: 'error', message: 'Roster mismatch' },
]

mock.module('../../../src/core/doctor', () => ({
  getLastResults: mock(() => ({
    results: mockDoctorResults,
    timestamp: Date.now(),
  })),
  runDiagnostics: mock(async () => mockDoctorResults),
}))

mock.module('../../../src/core/agent-usage', () => ({
  getAllAgentUsage: () => [
    { agent: 'patch', sessionId: 's1', model: 'claude-4', messages: 10, tokens: { total: 1000 }, cost: { total: 0.05 } },
  ],
}))

mock.module('../../../src/core/search-registry', () => ({
  getSearchHealth: mock(async () => ({
    enabled: false,
    tables: [],
  })),
  // plugin-registry.ts (transitively imported by health/managed-blocks via
  // getHookRegistry) re-imports buildSearchAPI; provide a no-op stub.
  buildSearchAPI: () => ({
    registerContentType: mock(),
    registerFileBackedContentType: mock(),
    index: mock(async () => {}),
    remove: mock(async () => {}),
    transform: mock(async () => {}),
    query: mock(async () => ({ results: [], aggregations: undefined, meta: { query: '', total: 0, took_ms: 0, source: 'fallback' } })),
  }),
}))

// Defensive stub — the test isolation hook scans for plugin refs in text
// and flags any mention of plugins/tasks even though we never import the
// module. Usage-feed assertions contain /api/plugins/tasks/* strings.
mock.module('../../../plugins/tasks/lib/flow-store', () => ({}))

// Registry snapshot accessor (plugins list only — exec tool stats are gone).
;(globalThis as unknown as { __bakinGetRegistrySnapshot: () => unknown[] }).__bakinGetRegistrySnapshot = () => [
  { id: 'tasks', name: 'Tasks', version: '1.0.0', description: 'Task management', source: 'built-in', routes: 5 },
  { id: 'health', name: 'Health', version: '1.0.0', description: 'System health', source: 'built-in', routes: 5 },
]

// MCP session accessor — replaces the old mocked /mcp/stats fetch.
;(globalThis as unknown as {
  __bakinGetMcpSessions: () => { activeSessions: Array<{ agent: string; sessions: number; connectedAt: string }>; upSince: string }
}).__bakinGetMcpSessions = () => ({
  activeSessions: [{ agent: 'patch', sessions: 1, connectedAt: '2026-04-01T10:00:00Z' }],
  upSince: '2026-04-01T00:00:00Z',
})

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { activatePlugin, findRoute, findTool, callRoute, callTool } from '../test-helpers'
const healthPlugin = (await import('../../../plugins/health')).default as typeof import('../../../plugins/health').default
import { recordUsage, clearUsage } from '../../../src/core/usage'

let activated: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  activated = await activatePlugin(healthPlugin, testDir)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
  mock.restore()
})

beforeEach(() => {
  clearUsage()
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
      expect(body.server).toBeDefined()
      expect(body.runtimeGatewayPort).toBe(18789)
      expect(body.upSince).toBe('2026-04-01T00:00:00Z')
      expect(Array.isArray(body.activeSessions)).toBe(true)
      expect((body.activeSessions as unknown[]).length).toBe(1)
    })

    it('no longer exposes legacy mcpHealth / restHealth / requests blocks', async () => {
      const route = findRoute(activated.routes, 'GET', '/summary')!
      const { body } = await callRoute(route, activated.ctx)
      expect(body.mcpHealth).toBeUndefined()
      expect(body.restHealth).toBeUndefined()
      expect(body.requests).toBeUndefined()
      expect(body.mcp).toBeUndefined()
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

    it('includes errors1h sourced from the real recorder', async () => {
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
    })
  })

  describe('GET /usage', () => {
    it('returns agent usage data', async () => {
      const route = findRoute(activated.routes, 'GET', '/usage')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, activated.ctx)
      expect(status).toBe(200)
      expect(Array.isArray(body)).toBe(true)
      const entries = body as unknown as Array<{ agent: string }>
      expect(entries[0].agent).toBe('patch')
    })
  })

  describe('GET /registry', () => {
    it('returns plugins list without execTools', async () => {
      const route = findRoute(activated.routes, 'GET', '/registry')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, activated.ctx)
      expect(status).toBe(200)
      expect(Array.isArray(body.plugins)).toBe(true)
      expect(body.execTools).toBeUndefined()
      expect((body.plugins as unknown[]).length).toBe(2)
    })
  })

  describe('GET /usage-feed', () => {
    it('returns usage entries from the real recorder', async () => {
      recordUsage({ kind: 'mcp', name: 'bakin_exec_tasks_list', agent: 'main-operator', durationMs: 12, status: 'ok' })
      recordUsage({ kind: 'mcp', name: 'bakin_exec_tasks_list', agent: 'main-operator', durationMs: 8, status: 'ok' })
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
    })

    it('defaults window to 1h when omitted', async () => {
      recordUsage({ kind: 'agent', name: 'heartbeat', agent: 'main-operator', durationMs: null, status: 'ok' })
      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      const { status, body } = await callRoute(route, activated.ctx)
      expect(status).toBe(200)
      expect((body as { totals: { count: number } }).totals.count).toBe(1)
    })

    it('filters by agent', async () => {
      recordUsage({ kind: 'mcp', name: 'x', agent: 'alice', durationMs: 1, status: 'ok' })
      recordUsage({ kind: 'mcp', name: 'x', agent: 'bob', durationMs: 1, status: 'ok' })
      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      const { body } = await callRoute(route, activated.ctx, {
        searchParams: { window: '1h', agent: 'alice' },
      })
      expect((body as { totals: { count: number } }).totals.count).toBe(1)
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
      const { status } = await callRoute(route, activated.ctx, {
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
    it('returns system health summary from real state', async () => {
      // Seed a few real usage entries; the exec tool now reads from the
      // unified recorder via getStatsByMs rather than a mocked HTTP source.
      recordUsage({ kind: 'mcp', name: 'bakin_exec_tasks_list', agent: 'patch', durationMs: 5, status: 'ok' })
      recordUsage({ kind: 'rest', name: '/api/plugins/tasks/list', agent: null, durationMs: 3, status: 'error' })

      const tool = findTool(activated.execTools, 'bakin_exec_health_status')!
      expect(tool).toBeDefined()

      const result = await callTool(tool, {})
      expect(result.ok).toBe(true)
      expect(result.memoryMB).toBeTypeOf('number')
      expect(result.totalMemoryMB).toBeTypeOf('number')
      expect(result.memoryPercent).toBeTypeOf('number')
      expect(result.activeSessions).toBe(1)
      expect(result.calls1h).toBe(2)
      expect(result.errors1h).toBe(1)
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
