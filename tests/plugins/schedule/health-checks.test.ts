/**
 * Schedule-plugin-owned doctor check.
 *
 * Exercises checkScheduleSync directly against runtime cron fixtures plus
 * sidecar.json files in a temp dir, rather than going through runDiagnostics.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-schedule-health-${Date.now()}-${randomUUID()}`)

process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { CronJob } from '@bakin/core/adapters/runtime'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))

mock.module('../../../packages/adapter-openclaw/src/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { checkScheduleSync, scheduleSyncRepair, checkScheduleCutover } from '../../../plugins/schedule/lib/health-checks'

const sidecarPath = join(testDir, 'schedule', 'sidecar.json')
let runtimeJobs: CronJob[] = []
let runtimeError: Error | null = null
const repairTarget = { type: 'all_actionable' as const, reportId: 'test-report' }

function observations<T extends { outcome: string }>(result: T) {
  if (result.outcome !== 'observed') throw new Error(`Expected observed schedule health, got ${result.outcome}`)
  return (result as T & { observations: Array<{ key: string; status: string; summary: string; incident?: { resolution: { type: string } } }> }).observations
}

const cronReader = {
  list: async () => {
    if (runtimeError) throw runtimeError
    return runtimeJobs
  },
}

function makeCronJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 'job-1',
    name: 'daily-recipe',
    schedule: '0 9 * * *',
    command: 'bakin:schedule:daily-recipe',
    enabled: true,
    ...overrides,
  }
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(join(testDir, 'schedule'), { recursive: true })
  runtimeJobs = []
  runtimeError = null
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('checkScheduleSync - no jobs', () => {
  it('reports ok when the runtime has no cron jobs', async () => {
    const results = observations(await checkScheduleSync(testDir, cronReader))
    expect(results).toHaveLength(1)
    expect(results[0].key).toBe('runtime-cron')
    expect(results[0].status).toBe('healthy')
    expect(results[0].summary).toMatch(/No runtime cron jobs/)
  })
})

describe('checkScheduleSync - orphan detection', () => {
  it('reports ok when all runtime jobs are tracked in the sidecar', async () => {
    runtimeJobs = [makeCronJob({ id: 'job-1', name: 'daily-recipe' })]
    writeFileSync(sidecarPath, JSON.stringify({
      version: 1,
      jobs: {
        'job-1': {
          jobId: 'job-1',
          isBakinJob: true,
          displayName: 'Daily Recipe',
          agentId: 'chef',
          createdAt: '2026-03-28T00:00:00Z',
          updatedAt: '2026-03-28T00:00:00Z',
        },
      },
    }))

    const results = observations(await checkScheduleSync(testDir, cronReader))
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('healthy')
    expect(results[0].summary).toMatch(/1 runtime cron job\(s\) are tracked/)
  })

  it('surfaces a repair action for orphaned runtime cron jobs', async () => {
    runtimeJobs = [makeCronJob({ id: 'orphan-1', name: 'rogue-cron' })]
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const results = observations(await checkScheduleSync(testDir, cronReader))
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warning')
    expect(results[0].incident?.resolution.type).toBe('repair')
    expect(results[0].summary).toMatch(/runtime cron job rogue-cron/i)
  })
})

describe('checkScheduleSync - repair', () => {
  it('does not track orphaned runtime cron jobs during diagnostics', async () => {
    runtimeJobs = [makeCronJob({ id: 'orphan-1', name: 'rogue-cron' })]
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const results = observations(await checkScheduleSync(testDir, cronReader))
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warning')

    const updated = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
    expect(updated.jobs['orphan-1']).toBeUndefined()
  })

  it('tracks orphaned runtime cron jobs in the sidecar through explicit repair without guessing the agent', async () => {
    runtimeJobs = [makeCronJob({ id: 'orphan-1', name: 'rogue-cron' })]
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const repair = scheduleSyncRepair(testDir, cronReader, async () => 'boss')
    const plan = await repair.plan(repairTarget)
    expect(plan).toHaveLength(1)
    const applied = await repair.apply(plan)
    expect(applied[0].status).toBe('applied')
    expect(applied[0].message).toMatch(/Tracked/)

    const updated = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
    expect(updated.jobs['orphan-1']).toBeDefined()
    expect(updated.jobs['orphan-1'].isBakinJob).toBe(false)
    expect(updated.jobs['orphan-1'].source).toBe('runtime')
    expect(updated.jobs['orphan-1'].requireTriage).toBe(true)
    expect(updated.jobs['orphan-1'].displayName).toBe('rogue-cron')
    expect(updated.jobs['orphan-1'].owner).toBe('boss')
    expect(updated.jobs['orphan-1'].agentId).toBeUndefined()
  })

  it('creates schedule/ directory through explicit repair when sidecar parent is missing', async () => {
    runtimeJobs = [makeCronJob({ id: 'orphan-1', name: 'rogue-cron' })]
    rmSync(join(testDir, 'schedule'), { recursive: true, force: true })
    expect(existsSync(join(testDir, 'schedule'))).toBe(false)

    const repair = scheduleSyncRepair(testDir, cronReader, async () => 'main')
    await repair.apply(await repair.plan(repairTarget))
    expect(existsSync(sidecarPath)).toBe(true)
  })
})

describe('checkScheduleSync - runtime failures', () => {
  it('warns when the runtime cron adapter cannot list jobs', async () => {
    runtimeError = new Error('adapter unavailable')
    const results = observations(await checkScheduleSync(testDir, cronReader))
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('unknown')
    expect(results[0].summary).toMatch(/Runtime cron jobs could not be read/)
  })
})

describe('plugin registration', () => {
  interface RegisteredDef {
    id: string
    run: () => Promise<{
      outcome: string
      observations?: Array<{ status: string; summary: string }>
      reason?: string
    }>
  }

  interface RegisteredAction {
    id: string
  }

  async function activateWithCtx(opts: { cron: boolean }): Promise<{
    checks: RegisteredDef[]
    actions: RegisteredAction[]
  }> {
    const schedulePlugin = (await import('../../../plugins/schedule')).default
    const checks: RegisteredDef[] = []
    const actions: RegisteredAction[] = []
    const noop = mock()
    const noopAsync = mock(async () => {})
    const ctx: Record<string, unknown> = {
      pluginId: 'schedule',
      runtime: {
        name: 'Test Runtime',
        agents: { list: mock(async () => [{ id: 'main', name: 'Main', role: 'Orchestrator' }]) },
        ...(opts.cron
          ? { cron: { list: mock(async () => []), get: mock(async () => null), remove: noopAsync } }
          : {}),
      },
      registerRoute: noop, registerExecTool: noop, registerNav: noop,
      registerSlot: noop, registerSkill: noop, registerWorkflow: noop,
      registerNodeType: noop, registerNotificationChannel: noop,
      registerHealthCheck: (def: RegisteredDef) => { checks.push(def); return `schedule.${def.id}` },
      registerHealthRepairAction: (def: RegisteredAction) => { actions.push(def); return `schedule.${def.id}` },
      watchFiles: noop,
      getSettings: () => ({}),
      updateSettings: noop,
      activity: { log: noop, audit: noop },
      hooks: { register: () => () => {}, has: () => false, invoke: noopAsync },
      search: {
        registerContentType: noop, registerFileBackedContentType: noop,
        index: noopAsync, remove: noopAsync, transform: noopAsync,
        query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'unavailable' as const } })),
      },
      storage: {},
      events: { on: noop, emit: noop, off: noop },
    }
    const plugin = schedulePlugin as { activate: (c: unknown) => Promise<void>; onShutdown?: () => void }
    await plugin.activate(ctx)
    plugin.onShutdown?.() // stop the scheduler interval started by activate
    return { checks, actions }
  }

  it('registers the schedule-sync orphan-cron check alongside schedule-cutover', async () => {
    // schedule-sync detects native runtime crons invisible to Bakin's sidecar
    // (e.g. created by an agent directly in the runtime). Its repair only
    // writes requireTriage sidecar entries — it must NEVER write runtime cron
    // state, which is what made the pre-#473 legacy sync check double-fire.
    // The obsolete main-session-wake repair stays gone.
    const { checks, actions } = await activateWithCtx({ cron: true })
    const checkIds = checks.map(def => def.id)
    const actionIds = actions.map(def => def.id)

    expect(checkIds).toContain('schedule-sync')
    expect(checkIds).toContain('schedule-cutover')
    expect(checkIds).not.toContain('schedule-legacy-cron-wake')
    expect(actionIds).toContain('track-runtime-cron')
    expect(actionIds).toContain('complete-cutover')

    const sync = checks.find(def => def.id === 'schedule-sync')!
    const result = await sync.run()
    expect(result.outcome).toBe('observed')
    expect(result.observations?.every(observation => observation.status === 'healthy')).toBe(true)
  })

  it('registers schedule-sync as not applicable on runtimes without native cron', async () => {
    const { checks, actions } = await activateWithCtx({ cron: false })
    const sync = checks.find(def => def.id === 'schedule-sync')
    expect(sync).toBeDefined()
    expect(actions.map(def => def.id)).not.toContain('track-runtime-cron')

    const result = await sync!.run()
    expect(result.outcome).toBe('not_applicable')
    expect(result.reason).toMatch(/no native cron/i)
  })
})

describe('schedule/checkScheduleCutover', () => {
  const cron = (ids: string[]) => ({ list: async () => ids.map(id => ({ id, name: id, schedule: '0 9 * * *', command: 'x', enabled: true })) as unknown as CronJob[] })

  it('is ok when no Bakin schedule has a backing runtime cron', async () => {
    const rows = observations(await checkScheduleCutover(cron(['native-1']), () => ['sch_a', 'sch_b']))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('healthy')
  })

  it('requires the cutover repair for a Bakin schedule still backed by runtime cron', async () => {
    const rows = observations(await checkScheduleCutover(cron(['sch_a', 'native-1']), () => ['sch_a', 'sch_b']))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('error')
    expect(rows[0].incident?.resolution.type).toBe('repair')
    expect(rows[0].summary).toContain('sch_a')
  })

  it('reports a warning when the runtime cannot be read', async () => {
    const failing = { list: async () => { throw new Error('runtime down') } }
    const rows = observations(await checkScheduleCutover(failing, () => ['sch_a']))
    expect(rows[0].status).toBe('unknown')
  })
})
