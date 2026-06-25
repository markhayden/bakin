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
  resetSettingsCache: () => {},
  getSettings: mock(() => ({
    runtime: {
      adapter: 'openclaw',
      settings: {},
    },
  })),
}))

const mockDoctorResults = [
  { check: 'runtime', status: 'ok', message: 'Runtime responding' },
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

const mockRepairPlan = {
  diagnostics: mockDoctorResults,
  items: [{
    id: 'repair.taskboard',
    checkId: 'taskboard',
    healthCheckId: 'tasks.taskboard',
    pluginId: 'tasks',
    checkName: 'Task board',
    title: 'Repair taskboard',
    reason: 'Missing columns',
    safety: 'safe',
    requiresConfirmation: true,
    changes: [{ kind: 'file', target: 'tasks/board.json', action: 'update', description: 'Add missing columns' }],
  }],
  errors: [],
  summary: { diagnostics: 3, repairableChecks: 1, totalItems: 1, safeItems: 1, blockedItems: 0, planErrors: 0 },
}
const mockRepairApply = {
  status: 'applied',
  plan: mockRepairPlan,
  applied: [{
    id: 'repair.taskboard',
    checkId: 'taskboard',
    status: 'applied',
    message: 'Added missing columns',
    changes: [{ kind: 'file', target: 'tasks/board.json', action: 'update', description: 'Add missing columns' }],
  }],
  skipped: [],
  errors: [],
  verification: [{ check: 'taskboard', status: 'ok', message: 'Taskboard healthy', autoFixable: false }],
  summary: { planned: 1, applied: 1, skipped: 0, failed: 0, verificationErrors: 0, verificationWarnings: 0 },
}
const planDoctorRepairMock = mock(async () => mockRepairPlan)
const applyDoctorRepairMock = mock(async (options: { accepted: boolean }) => (
  options.accepted ? mockRepairApply : { ...mockRepairApply, status: 'confirmation_required', applied: [], verification: [] }
))

mock.module('../../../src/core/doctor-repair', () => ({
  planDoctorRepair: planDoctorRepairMock,
  applyDoctorRepair: applyDoctorRepairMock,
}))

const mockDelegateRequest = {
  id: 'repair-1',
  kind: 'delegate',
  status: 'sent',
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:01:00.000Z',
  plan: mockRepairPlan,
  unresolved: [mockDoctorResults[2]],
  taskId: 'task-repair-1',
  agentId: 'main',
  events: [{ ts: '2026-04-01T00:00:00.000Z', type: 'created', message: 'created' }],
}
const delegateDoctorRepairMock = mock(async (options: { accepted: boolean }) => (
  options.accepted
    ? { status: 'sent', request: mockDelegateRequest, unresolved: mockDelegateRequest.unresolved }
    : { status: 'confirmation_required', request: { ...mockDelegateRequest, status: 'planned', taskId: undefined, agentId: undefined }, unresolved: mockDelegateRequest.unresolved }
))
const verifyDoctorRepairRequestMock = mock(async () => ({
  request: { ...mockDelegateRequest, status: 'verified' },
  remaining: [],
  verified: true,
}))

mock.module('../../../src/core/doctor-delegate', () => ({
  delegateDoctorRepair: delegateDoctorRepairMock,
  verifyDoctorRepairRequest: verifyDoctorRepairRequestMock,
}))

mock.module('../../../src/core/doctor-repair-store', () => ({
  listDoctorRepairRequests: mock(() => [mockDelegateRequest]),
  getDoctorRepairRequest: mock((_contentDir: string, id: string) => id === 'repair-1' ? mockDelegateRequest : null),
}))

mock.module('../../../src/core/agent-usage', () => ({
  getAllAgentUsage: () => [
    { agent: 'patch', sessionId: 's1', model: 'claude-4', messages: 10, tokens: { total: 1000 }, cost: { total: 0.05, source: 'runtime' } },
  ],
}))

mock.module('../../../src/core/search-registry', () => ({
  getSearchHealth: mock(async () => ({
    enabled: false,
    tables: [],
  })),
  getContentTypes: mock(() => []),
  purgeContentType: mock(async () => {}),
  // plugin-registry.ts can be reached by core agent-rules when rendering
  // workflow catalog snapshots; provide a no-op search API stub.
  buildSearchAPI: () => ({
    registerContentType: mock(),
    registerFileBackedContentType: mock(),
    index: mock(async () => {}),
    remove: mock(async () => {}),
    transform: mock(async () => {}),
    query: mock(async () => ({ results: [], aggregations: undefined, meta: { query: '', total: 0, took_ms: 0, source: 'fallback' } })),
  }),
}))

const taskStoreMock = {
  readTaskboard: () => ({ columns: { inProgress: [] } }),
  getAllTasks: () => ({ columns: { inProgress: [] } }),
  getTask: () => null,
  addTaskLog: mock(async () => {}),
  blockTask: mock(async () => {}),
  moveTask: mock(async () => {}),
}
// Defensive stub — the test isolation hook scans for plugin refs in text
// and flags any mention of plugins/tasks even though we never import the
// module. Usage-feed assertions contain /api/plugins/tasks/* strings.
mock.module('@/core/task-store', () => taskStoreMock)
mock.module('../../../src/core/task-store', () => taskStoreMock)

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
  it('registers 13 routes', () => {
    expect(activated.routes.length).toBe(13)
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

  describe('GET /search-status', () => {
    it('returns search adapter health data', async () => {
      const route = findRoute(activated.routes, 'GET', '/search-status')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, activated.ctx)
      expect(status).toBe(200)
      expect(body).toEqual({ enabled: false, tables: [] })
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
      expect(body.error).toBe('invalid input')
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

  describe('doctor repair routes', () => {
    it('returns a deterministic repair plan without applying it', async () => {
      const route = findRoute(activated.routes, 'GET', '/doctor/repair/plan')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, activated.ctx)

      expect(status).toBe(200)
      expect(body.summary).toMatchObject({ totalItems: 1, safeItems: 1 })
      expect(body.items).toEqual(mockRepairPlan.items)
      expect(planDoctorRepairMock).toHaveBeenCalled()
      expect(applyDoctorRepairMock).not.toHaveBeenCalled()
    })

    it('requires accepted=true before applying deterministic repairs', async () => {
      const route = findRoute(activated.routes, 'POST', '/doctor/repair/apply')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, activated.ctx, {
        body: { accepted: false },
      })

      expect(status).toBe(409)
      expect(body.status).toBe('confirmation_required')
      expect(applyDoctorRepairMock).toHaveBeenCalledWith(expect.objectContaining({ accepted: false }))
    })

    it('applies deterministic repairs when accepted=true', async () => {
      const route = findRoute(activated.routes, 'POST', '/doctor/repair/apply')!

      const { status, body } = await callRoute(route, activated.ctx, {
        body: { accepted: true, itemIds: ['repair.taskboard'] },
      })

      expect(status).toBe(200)
      expect(body.status).toBe('applied')
      expect(body.summary).toMatchObject({ applied: 1, failed: 0 })
      expect(applyDoctorRepairMock).toHaveBeenCalledWith(expect.objectContaining({
        accepted: true,
        itemIds: ['repair.taskboard'],
      }))
    })
  })

  describe('delegated repair routes', () => {
    it('requires accepted=true before creating a delegated repair task', async () => {
      const route = findRoute(activated.routes, 'POST', '/doctor/delegate')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, activated.ctx, {
        body: { accepted: false },
      })

      expect(status).toBe(409)
      expect(body.status).toBe('confirmation_required')
      expect(delegateDoctorRepairMock).toHaveBeenCalledWith(expect.objectContaining({ accepted: false }))
    })

    it('creates a delegated repair request when accepted=true', async () => {
      const route = findRoute(activated.routes, 'POST', '/doctor/delegate')!

      const { status, body } = await callRoute(route, activated.ctx, {
        body: { accepted: true },
      })

      expect(status).toBe(200)
      expect(body.status).toBe('sent')
      expect((body.request as Record<string, unknown>).taskId).toBe('task-repair-1')
      expect(delegateDoctorRepairMock).toHaveBeenCalledWith(expect.objectContaining({ accepted: true }))
    })

    it('lists and shows delegated repair requests', async () => {
      const listRoute = findRoute(activated.routes, 'GET', '/doctor/repair')!
      const showRoute = findRoute(activated.routes, 'GET', '/doctor/repair/:requestId')!

      const list = await callRoute(listRoute, activated.ctx)
      expect(list.status).toBe(200)
      expect(list.body.requests).toEqual([mockDelegateRequest])

      const show = await callRoute(showRoute, activated.ctx, {
        path: '/doctor/repair/repair-1',
      })
      expect(show.status).toBe(200)
      expect(show.body.request).toEqual(mockDelegateRequest)
    })

    it('verifies delegated repair requests', async () => {
      const route = findRoute(activated.routes, 'POST', '/doctor/repair/:requestId/verify')!

      const { status, body } = await callRoute(route, activated.ctx, {
        path: '/doctor/repair/repair-1/verify',
      })

      expect(status).toBe(200)
      expect(body.verified).toBe(true)
      expect(verifyDoctorRepairRequestMock).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'repair-1' }))
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
