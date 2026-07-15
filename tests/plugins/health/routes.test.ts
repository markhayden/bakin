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
import type { HealthReport } from '@makinbakin/sdk/types'
import type { ActivatedPlugin } from '../test-helpers'
import type { UsageEntry as HealthUsageEntry } from '../../../plugins/health/types'

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

const generatedAt = '2026-04-01T10:00:00.000Z'
const searchStages = [
  { key: 'engine' as const, label: 'Engine', status: 'healthy' as const, summary: 'Engine checks are healthy.', observedAt: generatedAt, staleAt: '2026-04-01T10:01:00.000Z', observationIds: ['health.search:engine'] },
  { key: 'queries' as const, label: 'Queries', status: 'healthy' as const, summary: 'Queries checks are healthy.', observedAt: generatedAt, staleAt: '2026-04-01T10:02:00.000Z', observationIds: ['health.search-canary:queries'] },
  { key: 'indexes' as const, label: 'Indexes', status: 'healthy' as const, summary: 'Indexes checks are healthy.', observedAt: generatedAt, staleAt: '2026-04-01T10:05:00.000Z', observationIds: ['health.search:indexes'] },
  { key: 'journal' as const, label: 'Journal', status: 'healthy' as const, summary: 'Journal checks are healthy.', observedAt: generatedAt, staleAt: '2026-04-01T10:01:00.000Z', observationIds: ['health.search:journal'] },
]

const cachedReport: HealthReport = {
  id: 'health-report-1',
  revision: 4,
  generatedAt,
  overallStatus: 'needs_attention',
  lastFullSweep: { id: 'sweep-1', startedAt: generatedAt, completedAt: generatedAt },
  checks: [],
  observations: [],
  incidents: [{
    id: 'tasks:taskboard:missing-columns', status: 'error', disposition: 'action_required',
    title: 'Task board columns are missing', impact: 'Tasks cannot move through the full workflow.',
    resources: [{ kind: 'plugin', id: 'tasks', label: 'Tasks' }],
    resolution: { key: 'repair-board', type: 'repair', label: 'Repair board', actionId: 'tasks.repair-store' },
    observationIds: ['tasks.taskboard:columns'], observedAt: generatedAt, staleAt: '2026-04-01T10:02:00.000Z', stale: false,
  }],
  subsystems: {
    search: {
      status: 'healthy', summary: 'Search is healthy across engine, queries, indexes, and journal.',
      observedAt: generatedAt, staleAt: '2026-04-01T10:01:00.000Z', stages: searchStages, incidentIds: [],
    },
  },
  summary: {
    checks: { registered: 37, completed: 37, failed: 0, invalid: 0, notApplicable: 0 },
    incidents: { actionRequired: 1, watching: 0, advisory: 0, unknown: 0 },
  },
}

const freshReport: HealthReport = { ...cachedReport, id: 'health-report-2', revision: 5 }
const runDiagnosticsMock = mock(async () => freshReport)

mock.module('../../../src/core/doctor', () => ({
  getLastReport: mock(() => cachedReport),
  runDiagnostics: runDiagnosticsMock,
  runTargetedDiagnostics: mock(async () => freshReport),
}))

const mockRepairPlan = {
  planId: 'repair-plan-1',
  basedOnReportId: cachedReport.id,
  target: { type: 'incidents' as const, reportId: cachedReport.id, ids: ['tasks:taskboard:missing-columns'] },
  createdAt: generatedAt,
  expiresAt: '2026-04-01T10:10:00.000Z',
  items: [{
    id: 'tasks.repair-store:repair.taskboard',
    actionId: 'tasks.repair-store',
    title: 'Repair taskboard',
    reason: 'Missing columns',
    safety: 'safe' as const,
    incidentIds: ['tasks:taskboard:missing-columns'],
    observationIds: ['tasks.taskboard:columns'],
    preconditions: [{ observationId: 'tasks.taskboard:columns', executionId: 'execution-1', status: 'error' as const, resolutionKey: 'repair-board' }],
    changes: [{ kind: 'file', target: 'tasks/board.json', action: 'update', description: 'Add missing columns' }],
  }],
}
const mockRepairApply = {
  planId: mockRepairPlan.planId,
  basedOnReportId: cachedReport.id,
  results: [{
    itemId: mockRepairPlan.items[0].id,
    actionId: 'tasks.repair-store',
    status: 'applied',
    message: 'Added missing columns',
    affectedCheckIds: ['tasks.taskboard'],
    changes: [{ kind: 'file', target: 'tasks/board.json', action: 'update', description: 'Add missing columns' }],
  }],
  affectedCheckIds: ['tasks.taskboard'],
  verifiedReportId: freshReport.id,
  verifiedIncidentIds: [],
  report: freshReport,
}
const planDoctorRepairMock = mock(async () => mockRepairPlan)
const applyDoctorRepairMock = mock(async () => mockRepairApply)

mock.module('../../../src/core/doctor-repair', () => ({
  planDoctorRepair: planDoctorRepairMock,
  applyDoctorRepair: applyDoctorRepairMock,
}))

const mockDelegateRequest = {
  id: 'repair-1',
  version: 2,
  kind: 'delegate',
  status: 'sent',
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:01:00.000Z',
  plan: mockRepairPlan,
  incidentIds: ['tasks:taskboard:missing-columns'],
  observationIds: ['tasks.taskboard:columns'],
  taskId: 'task-repair-1',
  agentId: 'main',
  events: [{ ts: '2026-04-01T00:00:00.000Z', type: 'created', message: 'created' }],
}
const delegateDoctorRepairMock = mock(async (options: { accepted: boolean }) => (
  options.accepted
    ? { status: 'sent', request: mockDelegateRequest, incidents: cachedReport.incidents }
    : { status: 'confirmation_required', request: { ...mockDelegateRequest, status: 'planned', taskId: undefined, agentId: undefined }, incidents: cachedReport.incidents }
))
const verifyDoctorRepairRequestMock = mock(async () => ({
  request: { ...mockDelegateRequest, status: 'verified' },
  remainingIncidentIds: [],
  verified: true,
  reportId: freshReport.id,
}))

mock.module('../../../src/core/doctor-delegate', () => ({
  delegateDoctorRepair: delegateDoctorRepairMock,
  verifyDoctorRepairRequest: verifyDoctorRepairRequestMock,
}))

mock.module('../../../src/core/doctor-repair-store', () => ({
  DoctorRepairRequestNotFoundError: class DoctorRepairRequestNotFoundError extends Error {},
  listDoctorRepairRequests: mock(() => [mockDelegateRequest]),
  getDoctorRepairRequest: mock((_contentDir: string, id: string) => id === 'repair-1' ? mockDelegateRequest : null),
}))

mock.module('../../../src/core/agent-usage', () => ({
  getAllAgentUsage: () => [
    {
      agent: 'patch',
      sessionId: 's1',
      sessionStarted: '2026-04-01T00:00:00.000Z',
      model: 'claude-4',
      messages: 10,
      tokens: { input: 600, output: 200, cacheRead: 200, cacheWrite: 0, total: 1_000 },
      cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: 0.05, source: 'runtime' },
    },
  ],
  // Consumed by the usage-history scanner, which rides the plugin's import
  // graph via the scan timer (#359).
  getSessionJsonlTierId: async () => null,
  parseSessionUsageMessages: () => ({ sessionId: '', sessionStarted: '', messages: [] }),
}))

mock.module('../../../src/core/search-registry', () => ({
  getSearchHealth: mock(async () => ({
    enabled: false,
    tables: [],
  })),
  getContentTypes: mock(() => []),
  purgeContentType: mock(async () => {}),
  // context.startup-size check → context-report → lesson-retrieval imports this.
  crossTableSearch: mock(async () => ({ results: [] })),
  // plugin-registry.ts can be reached by core agent-rules when rendering
  // workflow catalog snapshots; provide a no-op search API stub.
  buildSearchAPI: () => ({
    registerContentType: mock(),
    registerFileBackedContentType: mock(),
    index: mock(async () => {}),
    remove: mock(async () => {}),
    transform: mock(async () => {}),
    query: mock(async () => ({ results: [], aggregations: undefined, meta: { query: '', total: 0, took_ms: 0, source: 'unavailable' } })),
  }),
}))

const taskStoreMock = {
  readTaskboard: () => ({ columns: { inProgress: [] } }),
  getAllTasks: () => ({ columns: { inProgress: [] } }),
  getTask: () => null,
  addTaskLog: mock(async () => {}),
  blockTask: mock(async () => {}),
  moveTask: mock(async () => {}),
  // context.startup-size check → context-report → dispatch-workflow graph.
  updateTask: mock(async () => {}),
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
  runDiagnosticsMock.mockClear()
})

// ---------------------------------------------------------------------------
// Route tests
// ---------------------------------------------------------------------------

describe('Health Plugin Routes', () => {
  it('registers 20 routes', () => {
    expect(activated.routes.length).toBe(20)
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
      expect(body.doctor).toBeUndefined()
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

    it('returns unavailable instead of fabricating zero sessions when the MCP provider is absent', async () => {
      const host = globalThis as typeof globalThis & { __bakinGetMcpSessions?: () => unknown }
      const provider = host.__bakinGetMcpSessions
      delete host.__bakinGetMcpSessions
      try {
        const route = findRoute(activated.routes, 'GET', '/summary')!
        const { status, body } = await callRoute(route, activated.ctx)

        expect(status).toBe(503)
        expect(body.error).toBe('MCP session evidence is unavailable.')
        expect(body.activeSessions).toBeUndefined()
        expect(body.upSince).toBeUndefined()
      } finally {
        host.__bakinGetMcpSessions = provider
      }
    })

    it('includes server memory info', async () => {
      const route = findRoute(activated.routes, 'GET', '/summary')!
      const { body } = await callRoute(route, activated.ctx)
      const server = body.server as Record<string, unknown>
      expect(server.memoryMB).toBeTypeOf('number')
      expect(server.totalMemoryMB).toBeTypeOf('number')
      expect((server.totalMemoryMB as number)).toBeGreaterThan(0)
    })

    it('does not embed a competing doctor report', async () => {
      const route = findRoute(activated.routes, 'GET', '/summary')!
      const { body } = await callRoute(route, activated.ctx)
      expect(body.doctor).toBeUndefined()
      expect(body.report).toBeUndefined()
    })

    it('includes errors1h sourced from the real recorder', async () => {
      recordUsage({ kind: 'mcp', activityClass: 'user', name: 't1', agent: 'a', durationMs: 5, status: 'error' })
      recordUsage({ kind: 'mcp', activityClass: 'user', name: 't2', agent: 'a', durationMs: 5, status: 'error' })
      recordUsage({ kind: 'rest', activityClass: 'user', name: '/api/x', agent: null, durationMs: 5, status: 'error' })
      recordUsage({
        kind: 'rest', activityClass: 'routine', name: '/api/plugins/health/missing', agent: null, durationMs: 5, status: 'ok',
        meta: { httpStatus: 404 },
      })
      recordUsage({ kind: 'agent', activityClass: 'user', name: 'dispatch', agent: 'a', durationMs: null, status: 'ok' })

      const route = findRoute(activated.routes, 'GET', '/summary')!
      const { body } = await callRoute(route, activated.ctx)
      expect(body.errors1h).toEqual({
        total: 4,
        byKind: { mcp: 2, rest: 2, agent: 0 },
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

  describe('windowed telemetry query validation', () => {
    it.each(['/usage-history', '/agent-effort', '/interaction-summary'])(
      'rejects unknown query keys on GET %s',
      async (path) => {
        const route = findRoute(activated.routes, 'GET', path)!
        expect(route).toBeDefined()

        const { status, body } = await callRoute(route, activated.ctx, {
          searchParams: { window: '24h', unexpected: 'value' },
        })

        expect(status).toBe(400)
        expect(body.error).toBe('invalid input')
      },
    )
  })

  describe('GET /search-status', () => {
    it('returns search adapter health data', async () => {
      const route = findRoute(activated.routes, 'GET', '/search-status')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, activated.ctx)
      expect(status).toBe(200)
      // Adapter unavailable in the test ctx → disabled snapshot, no outbox.
      expect(body).toEqual({ enabled: false, tables: [] })
    })
  })

  describe('GET /search-readiness', () => {
    it('returns the cached canonical Search projection without executing diagnostics', async () => {
      const { runTargetedDiagnostics } = await import('../../../src/core/doctor')
      const route = findRoute(activated.routes, 'GET', '/search-readiness')!
      const { status, body } = await callRoute(route, activated.ctx)

      expect(status).toBe(200)
      expect(body.reportId).toBe(cachedReport.id)
      expect((body.readiness as { status: string }).status).toBe('healthy')
      expect(runTargetedDiagnostics).not.toHaveBeenCalled()
    })
  })

  describe('GET /search-telemetry', () => {
    it('composes usage windows, outbox stats, and search doctor rows', async () => {
      recordUsage({ kind: 'rest', activityClass: 'user', name: 'search.query', agent: null, durationMs: 12, status: 'ok' })
      recordUsage({ kind: 'rest', activityClass: 'user', name: 'search.query', agent: null, durationMs: 30, status: 'error' })
      recordUsage({ kind: 'rest', activityClass: 'system', name: 'search.drain', agent: null, durationMs: 5, status: 'ok', meta: { processed: 3 } })

      const route = findRoute(activated.routes, 'GET', '/search-telemetry')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, activated.ctx)
      expect(status).toBe(200)
      const telemetry = body as unknown as {
        windows: Record<string, { query: { count: number; errors: number }; drain: { count: number } }>
        outbox: { pending: number; quarantined: number }
        reportId: string
        readiness: { status: string }
        observations: unknown[]
      }
      expect(telemetry.windows['1h'].query.count).toBe(2)
      expect(telemetry.windows['1h'].query.errors).toBe(1)
      expect(telemetry.windows['1h'].drain.count).toBe(1)
      expect(typeof telemetry.outbox.pending).toBe('number')
      expect(telemetry.reportId).toBe(cachedReport.id)
      expect(telemetry.readiness.status).toBe('healthy')
      expect(Array.isArray(telemetry.observations)).toBe(true)
    })

    it('keeps core Search telemetry available when enrichment stats throw', async () => {
      const { getHookRegistry } = await import('../../../packages/core/src/hooks/hook-registry-singleton')
      const unregister = getHookRegistry().register('assets.enrichmentStats', () => {
        throw new Error('assets stats failed')
      }, 'test-health')
      try {
        const route = findRoute(activated.routes, 'GET', '/search-telemetry')!
        const { status, body } = await callRoute(route, activated.ctx)

        expect(status).toBe(200)
        expect(body.enrichment).toBeNull()
        expect(body.enrichmentEvidence).toEqual({ status: 'unavailable', reason: 'provider_failed' })
        expect(body.windows).toBeDefined()
        expect(body.outbox).toBeDefined()
      } finally {
        unregister()
      }
    })

    it('bounds a never-settling enrichment provider without losing core telemetry', async () => {
      const { getHookRegistry } = await import('../../../packages/core/src/hooks/hook-registry-singleton')
      const unregister = getHookRegistry().register(
        'assets.enrichmentStats',
        () => new Promise<never>(() => {}),
        'test-health',
      )
      try {
        const route = findRoute(activated.routes, 'GET', '/search-telemetry')!
        const outcome = await Promise.race([
          callRoute(route, activated.ctx),
          new Promise<'test-timeout'>((resolve) => setTimeout(() => resolve('test-timeout'), 1_000)),
        ])

        expect(outcome).not.toBe('test-timeout')
        if (outcome === 'test-timeout') return
        expect(outcome.status).toBe(200)
        expect(outcome.body.enrichment).toBeNull()
        expect(outcome.body.enrichmentEvidence).toEqual({ status: 'unavailable', reason: 'provider_timeout' })
      } finally {
        unregister()
      }
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

    it('returns unavailable instead of an empty plugin list when the provider is absent', async () => {
      const host = globalThis as typeof globalThis & { __bakinGetRegistrySnapshot?: () => unknown[] }
      const provider = host.__bakinGetRegistrySnapshot
      delete host.__bakinGetRegistrySnapshot
      try {
        const route = findRoute(activated.routes, 'GET', '/registry')!
        const { status, body } = await callRoute(route, activated.ctx)

        expect(status).toBe(503)
        expect(body.error).toBe('Plugin registry evidence is unavailable.')
        expect(body.plugins).toBeUndefined()
      } finally {
        host.__bakinGetRegistrySnapshot = provider
      }
    })
  })

  describe('GET /usage-feed', () => {
    it('returns usage entries from the real recorder', async () => {
      recordUsage({
        kind: 'mcp', activityClass: 'user', name: 'bakin_exec_tasks_list', agent: 'main-operator', durationMs: 12, status: 'ok',
        tokensIn: 120, tokensOut: 30, tokensCacheRead: 80, tokensCacheWrite: 10, costUsdMicros: 4_200,
      })
      recordUsage({ kind: 'mcp', activityClass: 'user', name: 'bakin_exec_tasks_list', agent: 'main-operator', durationMs: 8, status: 'ok' })
      recordUsage({ kind: 'rest', activityClass: 'user', name: '/api/plugins/tasks/list', agent: null, durationMs: 20, status: 'ok' })

      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, activated.ctx, {
        searchParams: { kind: 'mcp', window: '1h' },
      })
      expect(status).toBe(200)
      expect(body.capabilities).toEqual({
        exactFailureTargeting: true,
        sourceBalancedActivity: true,
      })
      const totals = (body as { totals: { count: number } }).totals
      const topByName = (body as {
        topByName: Array<{
          kind?: string
          method?: string | null
          name: string
          count: number
        }>
      }).topByName
      const recent = (body as { recent: HealthUsageEntry[] }).recent
      const recentFailures = (body as { recentFailures: Array<{ id: string }> }).recentFailures
      const recentUnverified = (body as { recentUnverified: Array<{ id: string }> }).recentUnverified
      expect(totals.count).toBe(2)
      expect(topByName[0].name).toBe('bakin_exec_tasks_list')
      expect(topByName[0].count).toBe(2)
      expect(topByName[0]).toMatchObject({
        kind: 'mcp',
        method: null,
      })
      expect(topByName[0]).not.toHaveProperty('failureGroupRank')
      expect(recent).toHaveLength(2)
      expect(new Set(recent.map((entry) => entry.id)).size).toBe(2)
      const metered = recent.find((entry) => entry.tokensIn === 120)
      expect(metered).toMatchObject({
        tokensIn: 120,
        tokensOut: 30,
        tokensCacheRead: 80,
        tokensCacheWrite: 10,
        costUsdMicros: 4_200,
      })
      expect(recentFailures).toEqual([])
      expect(recentUnverified).toEqual([])
    })

    it('returns the complete Activity dashboard contract for the requested window', async () => {
      const now = Date.now()
      const mcpFailureAt = new Date(now - 4_000).toISOString()
      const unattributedRestFailureAt = new Date(now - 2_500).toISOString()
      const restFailureAt = new Date(now - 2_000).toISOString()
      recordUsage({ kind: 'mcp', activityClass: 'user', name: 'shared-destination', agent: 'main', durationMs: 10, status: 'error', ts: mcpFailureAt })
      recordUsage({ kind: 'mcp', activityClass: 'user', name: 'shared-destination', agent: 'pixel', durationMs: 5, status: 'ok', ts: new Date(now - 3_000).toISOString() })
      recordUsage({ kind: 'rest', activityClass: 'system', name: 'shared-destination', agent: null, durationMs: 10, status: 'error', ts: unattributedRestFailureAt })
      recordUsage({ kind: 'rest', activityClass: 'user', name: 'shared-destination', agent: 'scout', durationMs: 30, status: 'error', ts: restFailureAt })
      recordUsage({
        kind: 'mcp', activityClass: 'user', name: 'tool-result-gap', agent: 'main', durationMs: 20, status: 'ok', ts: new Date(now - 1_500).toISOString(),
        meta: { resultMissing: true, turnTerminalStatus: 'completed' },
      })
      recordUsage({
        kind: 'agent', activityClass: 'user', name: 'dispatch-canceled', agent: 'patch', durationMs: null, status: 'ok', ts: new Date(now - 1_000).toISOString(),
        meta: { terminalStatus: 'aborted' },
      })
      recordUsage({ kind: 'agent', activityClass: 'user', name: 'dispatch-succeeded', agent: 'patch', durationMs: 50, status: 'ok', ts: new Date(now - 500).toISOString() })

      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      const { status, body } = await callRoute(route, activated.ctx, {
        searchParams: { window: '24h' },
      })
      expect(status).toBe(200)

      const feed = body as unknown as {
        window: string
        coverage: { startsAt: string; hasFullWindow: boolean; reason: string }
        outcomes: { failed: number; unverified: number; canceled: number; succeeded: number }
        byKind: Array<{ kind: string; total: number; failures: number }>
        failureGroupPage: { total: number; offset: number; limit: number; hasMore: boolean }
        failureGroups: Array<{
          kind: string
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
          latestFailure: HealthUsageEntry
        }>
      }
      expect(feed.window).toBe('24h')
      expect(Number.isFinite(Date.parse(feed.coverage.startsAt))).toBe(true)
      expect(typeof feed.coverage.hasFullWindow).toBe('boolean')
      expect(['full_window', 'process_restart', 'buffer_limit']).toContain(feed.coverage.reason)
      expect(feed.outcomes).toEqual({ failed: 3, unverified: 1, canceled: 1, succeeded: 2 })
      expect(feed.byKind).toEqual([
        { kind: 'mcp', total: 3, failures: 1 },
        { kind: 'rest', total: 2, failures: 2 },
        { kind: 'agent', total: 2, failures: 0 },
      ])
      expect(feed.failureGroupPage).toEqual({ total: 2, offset: 0, limit: 25, hasMore: false })
      expect(feed.failureGroups).toEqual([
        {
          kind: 'rest',
          name: 'shared-destination',
          destination: 'shared-destination',
          method: null,
          attempts: 2,
          failures: 2,
          firstFailureAt: unattributedRestFailureAt,
          lastFailureAt: restFailureAt,
          agents: ['scout'],
          unattributedFailures: 0,
          systemFailures: 1,
          medianFailureDurationMs: 20,
          latestFailure: expect.objectContaining({
            name: 'shared-destination',
            agent: 'scout',
            ts: restFailureAt,
          }),
        },
        {
          kind: 'mcp',
          name: 'shared-destination',
          destination: 'shared-destination',
          method: null,
          attempts: 2,
          failures: 1,
          firstFailureAt: mcpFailureAt,
          lastFailureAt: mcpFailureAt,
          agents: ['main'],
          unattributedFailures: 0,
          systemFailures: 0,
          medianFailureDurationMs: 10,
          latestFailure: expect.objectContaining({
            name: 'shared-destination',
            agent: 'main',
            ts: mcpFailureAt,
          }),
        },
      ])
    })

    it('exposes the exact agent count with a bounded by-agent projection', async () => {
      for (let index = 0; index < 12; index++) {
        recordUsage({
          kind: 'mcp', activityClass: 'user', name: 'agent-work', agent: `agent-${index}`, durationMs: 1, status: 'ok',
        })
      }
      recordUsage({
        kind: 'rest', activityClass: 'user', name: '/api/unattributed-work', agent: null, durationMs: 1, status: 'ok',
      })

      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      const { status, body } = await callRoute(route, activated.ctx, {
        searchParams: { window: '1h' },
      })
      const feed = body as unknown as {
        agentCount?: number
        byAgent: Array<{ agent: string; attributed: boolean }>
      }

      expect(status).toBe(200)
      expect({
        agentCount: feed.agentCount,
        attributedRows: feed.byAgent.filter((row) => row.attributed).length,
        unknownRows: feed.byAgent.filter((row) => !row.attributed).length,
        totalRows: feed.byAgent.length,
      }).toEqual({
        agentCount: 12,
        attributedRows: 10,
        unknownRows: 1,
        totalRows: 11,
      })
    })

    it('keeps a literal unknown agent separate from the unattributed projection', async () => {
      recordUsage({
        kind: 'mcp', activityClass: 'user', name: 'main-work', agent: 'main', durationMs: 1, status: 'ok',
      })
      recordUsage({
        kind: 'mcp', activityClass: 'user', name: 'named-unknown-work', agent: 'unknown', durationMs: 1, status: 'ok',
      })
      recordUsage({
        kind: 'rest', activityClass: 'user', name: '/api/unattributed-work', agent: null, durationMs: 1, status: 'ok',
      })

      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      const { status, body } = await callRoute(route, activated.ctx, {
        searchParams: { window: '1h' },
      })
      const feed = body as unknown as {
        agentCount: number
        byAgent: Array<{
          agent: string
          attributed: boolean
          count: number
          errors: number
          lastActivity: unknown
        }>
      }

      expect(status).toBe(200)
      expect(feed.agentCount).toBe(2)
      expect(feed.byAgent.filter((row) => row.agent === 'unknown')).toEqual([
        { agent: 'unknown', attributed: true, count: 1, errors: 0, lastActivity: expect.anything() },
        { agent: 'unknown', attributed: false, count: 1, errors: 0, lastActivity: expect.anything() },
      ])
    })

    it('paginates failure groups with a safe bounded limit', async () => {
      const now = Date.now()
      for (let index = 0; index < 3; index++) {
        recordUsage({
          kind: 'rest',
          activityClass: 'user',
          name: `/api/plugins/tasks/task-${index}`,
          agent: 'main',
          durationMs: index + 1,
          status: 'error',
          ts: new Date(now - (3 - index) * 1000).toISOString(),
          meta: {
            routePattern: `/api/plugins/tasks/:taskId/action-${index}`,
            method: index === 2 ? 'POST' : 'GET',
            error: `failure-${index}`,
          },
        })
      }

      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      const { status, body } = await callRoute(route, activated.ctx, {
        searchParams: {
          window: '1h',
          failureGroupOffset: '1',
          failureGroupLimit: '1',
        },
      })

      expect(status).toBe(200)
      expect(body.failureGroupPage).toEqual({ total: 3, offset: 1, limit: 1, hasMore: true })
      expect(body.failureGroups).toEqual([
        expect.objectContaining({
          destination: '/api/plugins/tasks/:taskId/action-1',
          method: 'GET',
          latestFailure: expect.objectContaining({
            name: '/api/plugins/tasks/task-1',
            meta: expect.objectContaining({ error: 'failure-1' }),
          }),
        }),
      ])
    })

    it('resolves an exact failure target to its current ranked page', async () => {
      const destination = '/api/plugins/search/query'
      recordUsage({
        kind: 'rest', activityClass: 'user', name: destination, agent: 'main', durationMs: 4, status: 'error',
        meta: { method: 'POST', routePattern: destination },
      })
      for (let index = 0; index < 2; index++) {
        recordUsage({
          kind: 'mcp', activityClass: 'user', name: `leader-${index}`, agent: 'main', durationMs: 2, status: 'error',
        })
      }

      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      const { status, body } = await callRoute(route, activated.ctx, {
        searchParams: {
          window: '1h',
          failureGroupLimit: '1',
          failureGroupTargetKind: 'rest',
          failureGroupTargetMethod: 'post',
          failureGroupTargetDestination: destination,
        },
      })

      expect(status).toBe(200)
      expect(body.failureGroupPage).toEqual({ total: 3, offset: 2, limit: 1, hasMore: false })
      expect(body.failureGroups).toEqual([
        expect.objectContaining({ kind: 'rest', method: 'POST', destination }),
      ])
    })

    it('accepts an empty target method as the exact null method', async () => {
      recordUsage({
        kind: 'mcp', activityClass: 'user', name: 'web.search', agent: 'main', durationMs: 4, status: 'error',
      })

      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      const { status, body } = await callRoute(route, activated.ctx, {
        searchParams: {
          failureGroupTargetKind: 'mcp',
          failureGroupTargetMethod: '',
          failureGroupTargetDestination: 'web.search',
        },
      })

      expect(status).toBe(200)
      expect((body.failureGroups as Array<Record<string, unknown>>)[0]).toMatchObject({
        kind: 'mcp', method: null, destination: 'web.search',
      })
    })

    it('rejects partial exact failure targets', async () => {
      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      const partialTargets: Array<Record<string, string>> = [
        { failureGroupTargetKind: 'rest' },
        { failureGroupTargetKind: 'rest', failureGroupTargetMethod: 'GET' },
        { failureGroupTargetDestination: '/api/plugins/search/query' },
      ]

      for (const searchParams of partialTargets) {
        const result = await callRoute(route, activated.ctx, { searchParams })
        expect(result.status).toBe(400)
      }
    })

    it('defaults to 1h and hides successful routine activity', async () => {
      recordUsage({ kind: 'agent', activityClass: 'routine', name: 'heartbeat', agent: 'main-operator', durationMs: null, status: 'ok' })
      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      const { status, body } = await callRoute(route, activated.ctx)
      expect(status).toBe(200)
      expect((body as { totals: { count: number } }).totals.count).toBe(0)
    })

    it('includes routine success only when requested and never hides routine failure', async () => {
      recordUsage({ kind: 'agent', activityClass: 'routine', name: 'heartbeat', agent: 'main-operator', durationMs: null, status: 'ok' })
      recordUsage({ kind: 'agent', activityClass: 'routine', name: 'heartbeat', agent: 'main-operator', durationMs: null, status: 'error' })
      const route = findRoute(activated.routes, 'GET', '/usage-feed')!

      const hidden = await callRoute(route, activated.ctx, { searchParams: { window: '1h' } })
      expect((hidden.body as { totals: { count: number } }).totals.count).toBe(1)

      const shown = await callRoute(route, activated.ctx, { searchParams: { window: '1h', includeRoutine: 'true' } })
      expect((shown.body as { totals: { count: number } }).totals.count).toBe(2)
    })

    it('filters by agent', async () => {
      recordUsage({ kind: 'mcp', activityClass: 'user', name: 'x', agent: 'alice', durationMs: 1, status: 'ok' })
      recordUsage({ kind: 'mcp', activityClass: 'user', name: 'x', agent: 'bob', durationMs: 1, status: 'ok' })
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

    it('rejects unsafe failure-group pagination values', async () => {
      const route = findRoute(activated.routes, 'GET', '/usage-feed')!
      const negativeOffset = await callRoute(route, activated.ctx, {
        searchParams: { failureGroupOffset: '-1' },
      })
      const oversizedLimit = await callRoute(route, activated.ctx, {
        searchParams: { failureGroupLimit: '101' },
      })

      expect(negativeOffset.status).toBe(400)
      expect(oversizedLimit.status).toBe(400)
    })
  })

  describe('GET /interaction-summary', () => {
    it('returns a meaningful-interaction dashboard summary from the real recorder', async () => {
      recordUsage({
        kind: 'mcp', activityClass: 'user', name: 'bakin_exec_images_generate', agent: 'main-operator', durationMs: 40, status: 'ok',
        meta: { resultMissing: true, turnTerminalStatus: 'completed' },
      })
      recordUsage({ kind: 'rest', activityClass: 'system', name: '/api/search/query', agent: null, durationMs: 20, status: 'error' })
      recordUsage({ kind: 'agent', activityClass: 'routine', name: 'heartbeat', agent: 'main-operator', durationMs: null, status: 'ok' })

      const route = findRoute(activated.routes, 'GET', '/interaction-summary')
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route!, activated.ctx, {
        searchParams: { window: '1h' },
      })
      expect(status).toBe(200)

      const summary = body as unknown as {
        window: string
        coverage: { startsAt: string; hasFullWindow: boolean; reason: string }
        totals: { count: number; errors: number; unverified: number; foreground: number; background: number }
        categories: Array<{ key: string; count: number; errors: number }>
        topDestinations: Array<{ category: string; name: string; count: number; errors: number; medianDurationMs: number | null }>
        timeBuckets: Array<{ start: string; count: number; failureCount: number }>
      }
      expect(summary.window).toBe('1h')
      expect(Number.isFinite(Date.parse(summary.coverage.startsAt))).toBe(true)
      expect(typeof summary.coverage.hasFullWindow).toBe('boolean')
      expect(['full_window', 'process_restart', 'buffer_limit']).toContain(summary.coverage.reason)
      expect(summary.totals).toEqual({ count: 2, errors: 1, unverified: 1, foreground: 1, background: 1 })
      expect(summary.categories).toEqual([
        { key: 'tools', count: 1, errors: 0 },
        { key: 'api', count: 1, errors: 1 },
        { key: 'agents', count: 0, errors: 0 },
      ])
      expect(summary.topDestinations).toEqual(expect.arrayContaining([
        { category: 'tools', name: 'bakin_exec_images_generate', count: 1, errors: 0, medianDurationMs: 40 },
        { category: 'api', name: '/api/search/query', count: 1, errors: 1, medianDurationMs: 20 },
      ]))
      expect(summary.topDestinations.some((destination) => destination.name === 'heartbeat')).toBe(false)
      expect(summary.timeBuckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(2)
      expect(summary.timeBuckets.reduce((total, bucket) => total + bucket.failureCount, 0)).toBe(1)
    })
  })

  describe('GET /doctor', () => {
    it('returns the raw cached canonical report by default', async () => {
      const route = findRoute(activated.routes, 'GET', '/doctor')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, activated.ctx)
      expect(status).toBe(200)
      expect(body.id).toBe(cachedReport.id)
      expect(body.overallStatus).toBe('needs_attention')
      expect(body.results).toBeUndefined()
    })

    it('rejects state-changing query parameters without running diagnostics', async () => {
      const route = findRoute(activated.routes, 'GET', '/doctor')!

      const { status } = await callRoute(route, activated.ctx, {
        searchParams: { fresh: 'true' },
      })
      expect(status).toBe(400)
      expect(runDiagnosticsMock).not.toHaveBeenCalled()
    })

    it('runs fresh diagnostics only through the explicit JSON POST route', async () => {
      const route = findRoute(activated.routes, 'POST', '/doctor/run')!

      const { status, body } = await callRoute(route, activated.ctx, {
        body: { notifyAgent: true },
      })
      expect(status).toBe(200)
      expect(body.id).toBe(freshReport.id)
      expect(runDiagnosticsMock).toHaveBeenCalledWith(testDir, process.cwd(), { notifyAgent: true })
    })
  })

  describe('doctor repair routes', () => {
    it('returns a deterministic repair plan without applying it', async () => {
      const route = findRoute(activated.routes, 'POST', '/doctor/repair/plan')!
      expect(route).toBeDefined()

      const target = { type: 'incidents', reportId: cachedReport.id, ids: ['tasks:taskboard:missing-columns'] }
      const { status, body } = await callRoute(route, activated.ctx, { body: { target } })

      expect(status).toBe(200)
      expect(body.planId).toBe(mockRepairPlan.planId)
      expect(body.items).toEqual(mockRepairPlan.items)
      expect(planDoctorRepairMock).toHaveBeenCalledWith(expect.objectContaining({ target }))
      expect(applyDoctorRepairMock).not.toHaveBeenCalled()
    })

    it('rejects the removed accepted=true repair shape', async () => {
      const route = findRoute(activated.routes, 'POST', '/doctor/repair/apply')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, activated.ctx, {
        body: { accepted: false },
      })

      expect(status).toBe(400)
      expect(body.error).toBe('invalid input')
      expect(applyDoctorRepairMock).not.toHaveBeenCalled()
    })

    it('applies selected items from a server-held repair plan', async () => {
      const route = findRoute(activated.routes, 'POST', '/doctor/repair/apply')!

      const { status, body } = await callRoute(route, activated.ctx, {
        body: { planId: mockRepairPlan.planId, itemIds: [mockRepairPlan.items[0].id], confirmedItemIds: [] },
      })

      expect(status).toBe(200)
      expect(body.verifiedReportId).toBe(freshReport.id)
      expect(body.results).toEqual(mockRepairApply.results)
      expect(applyDoctorRepairMock).toHaveBeenCalledWith(expect.objectContaining({
        planId: mockRepairPlan.planId,
        itemIds: [mockRepairPlan.items[0].id],
        confirmedItemIds: [],
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
      recordUsage({ kind: 'mcp', activityClass: 'user', name: 'bakin_exec_tasks_list', agent: 'patch', durationMs: 5, status: 'ok' })
      recordUsage({ kind: 'rest', activityClass: 'user', name: '/api/plugins/tasks/list', agent: null, durationMs: 3, status: 'error' })

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
      expect(result.overallStatus).toBe('needs_attention')
      expect(result.reportId).toBe(cachedReport.id)
      expect(result.incidents).toEqual(cachedReport.summary.incidents)
    })
  })

  describe('bakin_exec_health_doctor', () => {
    it('returns the cached canonical report when fresh is not set', async () => {
      const tool = findTool(activated.execTools, 'bakin_exec_health_doctor')!
      expect(tool).toBeDefined()

      const result = await callTool(tool, {})
      expect(result.ok).toBe(true)
      expect((result.report as HealthReport).id).toBe(cachedReport.id)
    })

    it('runs fresh diagnostics when fresh=true', async () => {
      const { runDiagnostics } = await import('../../../src/core/doctor')
      const tool = findTool(activated.execTools, 'bakin_exec_health_doctor')!

      const result = await callTool(tool, { fresh: true })
      expect(result.ok).toBe(true)
      expect((result.report as HealthReport).id).toBe(freshReport.id)
      expect(runDiagnostics).toHaveBeenCalled()
    })
  })
})
