/**
 * Tests for schedule plugin activation and search wiring: search indexing on
 * activation, the auto-registered GET /search route, route/exec-tool
 * registration, and the schedule.ensureBakinJob provisioning hook.
 * Split from routes.test.ts (FW7); shared runtime-cron scaffold lives in
 * helpers/schedule-harness.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ActivatedPlugin } from '../test-helpers'
import { createScheduleCronHarness, makeBakinPaths, makeMergedJob } from './helpers/schedule-harness'

// ---------------------------------------------------------------------------
// Temp directory
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `bakin-test-schedule-activation-${Date.now()}`)
const sidecarDir = join(testDir, 'schedule')

// ES imports are hoisted above mock.module — set env so the guards don't trip
// when plugin modules call getContentDir/getOpenClawHome at init.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + '-openclaw'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// (mock.module stays per-file; only pure builders/fakes live in the helper)
// ---------------------------------------------------------------------------

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => testDir + '-openclaw',
  getOpenClawPath: (...parts: string[]) => join(testDir + '-openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

// Dual content-dir mock (CLAUDE.md testing rules): both the app facade and the
// packages/core resolver. getBakinPaths must be full-shape — these tests hit
// the REAL execution ledger, which resolves its SQLite path via .db.
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => makeBakinPaths(testDir),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => makeBakinPaths(testDir),
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

mock.module('../../../src/core/audit', () => ({
  appendAudit: mock(),
}))

const mockCreateTask = mock((opts?: unknown) => {
  void opts
  return Promise.resolve({ id: 'task-new', workflowId: undefined })
})
class MockTaskValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'TaskValidationError' }
}
mock.module('../../../src/core/task-service', () => ({
  createTaskWithEffects: (opts: unknown) => mockCreateTask(opts),
  validateTeamRef: async (teamId: string) => {
    if (teamId !== 'development') throw new MockTaskValidationError(`Unknown team: "${teamId}"`)
  },
  validateTeamAssignment: async (opts: { assignee?: string; team?: string }) => {
    if (opts.assignee && opts.team) throw new MockTaskValidationError('Cannot set both an agent and a team')
    if (opts.team && opts.team !== 'development') throw new MockTaskValidationError(`Unknown team: "${opts.team}"`)
  },
  TaskValidationError: MockTaskValidationError,
}))

// Mock plugin-registry (hook registry used by bridge — not under test here but must be present)
mock.module('../../../src/core/plugin-registry', () => ({
  getHookRegistry: () => ({
    invoke: mock(async () => undefined),
    register: mock(() => () => {}),
    has: mock(() => false),
  }),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: mock(async () => undefined),
    register: mock(() => () => {}),
    has: mock(() => false),
  }),
}))

// Mock runtime cron and jobs-reader — activation exercises adapter calls while
// keeping merged schedule data deterministic for assertions.
const harness = createScheduleCronHarness()
const {
  mockMergedJobs,
  mockRuntimeCronJobs,
  mockCronCreate,
  mockCronUpdate,
} = harness

mock.module('@bakin/core/adapters/runtime/testing', () => ({
  createMockRuntimeAdapter: () => harness.createMockRuntimeAdapter(),
}))

mock.module('@bakin/schedule/lib/jobs-reader', () => harness.jobsReaderModule())

// Mock cron-parser — parseSchedule and cronToHuman
mock.module('@bakin/schedule/lib/cron-parser', () => harness.cronParserModule())

// We need real sidecar since provisioning mutates state on disk via upsertJob/getJob.
// The sidecar module reads getContentDir() which returns testDir, so it uses our temp dir.
// Do NOT mock sidecar — let it hit the filesystem.

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { activatePlugin, findRoute, findTool, callRoute, callSearchRoute } from '../test-helpers'
const schedulePlugin = (await import('@bakin/schedule/index')).default
import { getJob } from '@bakin/schedule/lib/sidecar'
import { closeDb } from '../../../packages/core/src/storage/db'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let plugin: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(sidecarDir, { recursive: true })
  plugin = await activatePlugin(schedulePlugin, testDir)
})

beforeEach(() => {
  mock.clearAllMocks()
  harness.reset()
  // Reset sidecar on disk
  writeFileSync(join(sidecarDir, 'sidecar.json'), JSON.stringify({ version: 1, jobs: {} }))
})

afterAll(() => {
  closeDb() // release the ledger handle before deleting its inode (SQLITE_IOERR_VNODE)
  rmSync(testDir, { recursive: true, force: true })
})

describe('schedule search indexing', () => {
  it('indexes existing runtime jobs on activation with searchable schedule text', async () => {
    mockMergedJobs.push(makeMergedJob({
      id: 'job-search-1',
      displayName: 'Weekly planning',
      humanSchedule: 'Every Monday at 9am',
      taskPrompt: 'Create the weekly planning task',
      paused: false,
      enabled: true,
    }))

    const activated = await activatePlugin(schedulePlugin, testDir)

    expect(activated.ctx.search.index).toHaveBeenCalledWith('job-search-1', expect.objectContaining({
      name: 'Weekly planning',
      schedule: 'Every Monday at 9am',
      command: 'Create the weekly planning task',
      agent: 'chef',
      enabled: 'true',
    }))
  })

})

// ===========================================================================
// /search route (auto-registered via ctx.search.registerContentType)
// ===========================================================================

describe('GET /search', () => {
  it('returns seeded job results for a happy-path query', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    activated.seedResults([
      {
        id: 'job-search-a',
        table: 'bakin_schedule',
        score: 1.5,
        fields: {
          name: 'Weekly planning',
          schedule: 'Every Monday at 9am',
          command: 'Plan the week',
          agent: 'chef',
          enabled: 'true',
        },
      },
      {
        id: 'job-search-b',
        table: 'bakin_schedule',
        score: 0.9,
        fields: {
          name: 'Daily report',
          schedule: 'Every day at 9am',
          command: 'Generate report',
          agent: 'pixel',
          enabled: 'true',
        },
      },
    ])

    const { status, body } = await callSearchRoute(activated, 'planning')
    expect(status).toBe(200)
    expect(Array.isArray(body.results)).toBe(true)
    const results = body.results as Array<Record<string, unknown>>
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('job-search-a')
    expect(body.meta).toMatchObject({ query: 'planning', total: 2 })
  })

  it('returns 400 when ?q= is missing', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    const route = findRoute(activated.routes, 'GET', '/search')!
    expect(route).toBeDefined()
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(400)
    expect(body.error).toBe('invalid input')
  })

  it('passes ?facets=agent,enabled through to ctx.search.query', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    activated.seedResults([])

    await callSearchRoute(activated, 'anything', { facets: 'agent,enabled' })

    expect(activated.ctx.search.query).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'anything',
        facets: ['agent', 'enabled'],
      }),
    )
  })

  it('returns 200 with empty results when no jobs match', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    activated.seedResults([])

    const { status, body } = await callSearchRoute(activated, 'nothing-matches')
    expect(status).toBe(200)
    expect(body.results).toEqual([])
    expect(body.meta).toMatchObject({ query: 'nothing-matches', total: 0 })
  })
})

// ===========================================================================
// Plugin lifecycle
// ===========================================================================

describe('schedule plugin activation', () => {
  it('registers all expected routes', () => {
    const expectedRoutes = [
      { method: 'GET', path: '/' },
      { method: 'POST', path: '/' },
      { method: 'PUT', path: '/:jobId' },
      { method: 'DELETE', path: '/:jobId' },
      { method: 'POST', path: '/:jobId/pause' },
      { method: 'POST', path: '/:jobId/run' },
      { method: 'GET', path: '/:jobId/runs' },
      { method: 'POST', path: '/parse' },
    ]

    for (const expected of expectedRoutes) {
      const route = findRoute(plugin.routes, expected.method, expected.path)
      expect(route, `Missing route: ${expected.method} ${expected.path}`).toBeDefined()
    }
  })

  it('registers all expected exec tools', () => {
    const expectedTools = [
      'bakin_exec_schedule_list',
      'bakin_exec_schedule_create',
      'bakin_exec_schedule_update',
      'bakin_exec_schedule_pause',
      'bakin_exec_schedule_delete',
      'bakin_exec_schedule_get',
      'bakin_exec_schedule_run_now',
      'bakin_exec_schedule_briefing',
    ]

    for (const name of expectedTools) {
      const tool = findTool(plugin.execTools, name)
      expect(tool, `Missing exec tool: ${name}`).toBeDefined()
    }
  })

  it('provisions a Bakin schedule in the store keyed by logical id (no OpenClaw cron)', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    const registerMock = activated.ctx.hooks.register as unknown as {
      mock: { calls: Array<[string, (data: Record<string, unknown>) => Promise<Record<string, unknown>>, Record<string, unknown>]> }
    }
    const call = registerMock.mock.calls.find(([name]) => name === 'schedule.ensureBakinJob')

    expect(call).toBeDefined()
    const handler = call![1]
    const result = await handler({
      jobId: 'plugin-nightly-sync',
      name: 'Plugin nightly sync',
      schedule: '*/5 * * * *',
      command: 'bakin:reports:refresh',
      metadata: { pluginId: 'reports' },
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      jobId: 'plugin-nightly-sync',
      expr: '*/5 * * * *',
    }))
    expect(mockCronCreate).not.toHaveBeenCalled()
    expect(getJob('plugin-nightly-sync')).toEqual(expect.objectContaining({
      isBakinJob: true,
      source: 'bakin',
      displayName: 'Plugin nightly sync',
      logicalJobId: 'plugin-nightly-sync',
      schedule: { kind: 'cron', expr: '*/5 * * * *' },
    }))
  })

  it('ensureBakinJob: input teamId replaces an existing agentId (exclusion, review R5)', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    const registerMock = activated.ctx.hooks.register as unknown as {
      mock: { calls: Array<[string, (data: Record<string, unknown>) => Promise<Record<string, unknown>>, Record<string, unknown>]> }
    }
    const handler = registerMock.mock.calls.find(([name]) => name === 'schedule.ensureBakinJob')![1]

    await handler({ jobId: 'r5-job', name: 'R5', schedule: '*/5 * * * *', command: 'x', agentId: 'chef' })
    expect(getJob('r5-job')).toEqual(expect.objectContaining({ agentId: 'chef' }))

    const result = await handler({ jobId: 'r5-job', name: 'R5', schedule: '*/5 * * * *', command: 'x', teamId: 'development' })
    expect(result.ok).toBe(true)
    const meta = getJob('r5-job')!
    expect(meta.teamId).toBe('development')
    expect(meta.agentId).toBeUndefined() // never both (review R5)
  })

  it('ensureBakinJob: rejects agentId + teamId together (review R5)', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    const registerMock = activated.ctx.hooks.register as unknown as {
      mock: { calls: Array<[string, (data: Record<string, unknown>) => Promise<Record<string, unknown>>, Record<string, unknown>]> }
    }
    const handler = registerMock.mock.calls.find(([name]) => name === 'schedule.ensureBakinJob')![1]

    const result = await handler({ jobId: 'r5-both', name: 'R5', schedule: '*/5 * * * *', command: 'x', agentId: 'chef', teamId: 'development' })
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('both')
    expect(getJob('r5-both')).toBeNull()
  })

  it('ensureBakinJob: rejects an unknown teamId (review R5)', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    const registerMock = activated.ctx.hooks.register as unknown as {
      mock: { calls: Array<[string, (data: Record<string, unknown>) => Promise<Record<string, unknown>>, Record<string, unknown>]> }
    }
    const handler = registerMock.mock.calls.find(([name]) => name === 'schedule.ensureBakinJob')![1]

    const result = await handler({ jobId: 'r5-ghost', name: 'R5', schedule: '*/5 * * * *', command: 'x', teamId: 'ghost-team' })
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('Unknown team')
    expect(getJob('r5-ghost')).toBeNull()
  })

  it('updates an existing Bakin schedule by logical id after a rename', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    const registerMock = activated.ctx.hooks.register as unknown as {
      mock: { calls: Array<[string, (data: Record<string, unknown>) => Promise<Record<string, unknown>>, Record<string, unknown>]> }
    }
    const call = registerMock.mock.calls.find(([name]) => name === 'schedule.ensureBakinJob')
    expect(call).toBeDefined()
    const handler = call![1]

    const first = await handler({
      jobId: 'plugin-nightly-sync',
      name: 'Plugin nightly sync',
      schedule: '*/5 * * * *',
      command: 'bakin:reports:refresh',
      metadata: { pluginId: 'reports' },
    })
    expect(first.jobId).toBe('plugin-nightly-sync')

    mockCronCreate.mockClear()
    mockCronUpdate.mockClear()

    const second = await handler({
      jobId: 'plugin-nightly-sync',
      name: 'Plugin nightly sync renamed',
      schedule: '0 2 * * *',
      command: 'bakin:reports:refresh',
      metadata: { pluginId: 'reports' },
    })

    expect(second).toEqual(expect.objectContaining({
      ok: true,
      jobId: 'plugin-nightly-sync',
      expr: '0 2 * * *',
    }))
    expect(mockCronCreate).not.toHaveBeenCalled()
    expect(mockCronUpdate).not.toHaveBeenCalled()
    expect(getJob('plugin-nightly-sync')).toEqual(expect.objectContaining({
      displayName: 'Plugin nightly sync renamed',
      logicalJobId: 'plugin-nightly-sync',
      schedule: { kind: 'cron', expr: '0 2 * * *' },
    }))
  })

  it('ignores runtime crons entirely (store-only provisioning)', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    const registerMock = activated.ctx.hooks.register as unknown as {
      mock: { calls: Array<[string, (data: Record<string, unknown>) => Promise<Record<string, unknown>>, Record<string, unknown>]> }
    }
    const call = registerMock.mock.calls.find(([name]) => name === 'schedule.ensureBakinJob')
    expect(call).toBeDefined()

    // A runtime cron with a matching command must NOT influence provisioning.
    mockRuntimeCronJobs.push({
      id: 'runtime-existing-reports-refresh',
      name: 'Existing reports refresh',
      schedule: '0 1 * * *',
      command: 'bakin:reports:refresh',
      enabled: true,
    })

    const result = await call![1]({
      jobId: 'plugin-nightly-sync',
      name: 'Plugin nightly sync',
      schedule: '*/5 * * * *',
      command: 'bakin:reports:refresh',
      metadata: { pluginId: 'reports' },
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      jobId: 'plugin-nightly-sync',
    }))
    expect(mockCronUpdate).not.toHaveBeenCalled()
    expect(mockCronCreate).not.toHaveBeenCalled()
    expect(getJob('plugin-nightly-sync')!.logicalJobId).toBe('plugin-nightly-sync')
  })

  it('sets pluginId to schedule', () => {
    expect(schedulePlugin.id).toBe('schedule')
  })
})
