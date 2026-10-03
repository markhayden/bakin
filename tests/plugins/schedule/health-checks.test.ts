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

import { checkScheduleSync, scheduleSyncRepair, checkScheduleCutover, checkSchedulePrompts, scheduleUnrunnableJobsRepair, unrunnableBakinJobs } from '../../../plugins/schedule/lib/health-checks'
import { getJob, upsertJob } from '../../../plugins/schedule/lib/sidecar'

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
    command: 'Post the daily recipe',
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
    const results = observations(await checkScheduleSync(cronReader))
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

    const results = observations(await checkScheduleSync(cronReader))
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('healthy')
    expect(results[0].summary).toMatch(/1 runtime cron job\(s\) are tracked/)
  })

  it('surfaces a repair action for orphaned runtime cron jobs', async () => {
    runtimeJobs = [makeCronJob({ id: 'orphan-1', name: 'rogue-cron' })]
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const results = observations(await checkScheduleSync(cronReader))
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

    const results = observations(await checkScheduleSync(cronReader))
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warning')

    const updated = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
    expect(updated.jobs['orphan-1']).toBeUndefined()
  })

  it('tracks orphaned runtime cron jobs in the sidecar through explicit repair without guessing the agent', async () => {
    runtimeJobs = [makeCronJob({ id: 'orphan-1', name: 'rogue-cron' })]
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const repair = scheduleSyncRepair(cronReader, async () => 'boss')
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

    const repair = scheduleSyncRepair(cronReader, async () => 'main')
    await repair.apply(await repair.plan(repairTarget))
    expect(existsSync(sidecarPath)).toBe(true)
  })
})

describe('checkScheduleSync - runtime-internal crons (spec D5)', () => {
  it('a native cron whose command is not a task prompt is healthy runtime-internal evidence, never an orphan', async () => {
    runtimeJobs = [
      makeCronJob({ id: 'dream', name: 'dream', command: '__openclaw_memory_core_short_term_promotion_dream__' }),
      makeCronJob({ id: 'hb', name: 'heartbeat', command: '' }),
    ]
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const results = observations(await checkScheduleSync(cronReader))
    expect(results.map((r) => [r.key, r.status])).toEqual([['runtime-cron', 'healthy'], ['runtime-internal', 'healthy']])
    expect(results[1]!.summary).toContain('2 runtime-internal cron job(s) stay native')
  })

  it('splits a mixed set: the real orphan gets the Track repair, the marker stays out of it', async () => {
    runtimeJobs = [
      makeCronJob({ id: 'orphan-1', name: 'rogue-cron' }),
      makeCronJob({ id: 'dream', name: 'dream', command: '__openclaw_memory_core_short_term_promotion_dream__' }),
    ]
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const results = observations(await checkScheduleSync(cronReader))
    expect(results.map((r) => [r.key, r.status])).toEqual([['orphan-orphan-1', 'warning'], ['runtime-internal', 'healthy']])

    const repair = scheduleSyncRepair(cronReader, async () => 'main')
    const plan = await repair.plan(repairTarget)
    expect(plan[0]!.reason).toContain('1 runtime cron job(s)')
    await repair.apply(plan)
    const updated = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
    expect(updated.jobs['orphan-1']).toBeDefined()
    expect(updated.jobs['dream']).toBeUndefined()
  })
})

describe('checkSchedulePrompts + remove-unrunnable-jobs (spec D5, plan review R2)', () => {
  function bakinJob(jobId: string, taskPrompt: string | undefined, name = jobId) {
    upsertJob({ jobId, isBakinJob: true, source: 'adopted', displayName: name, taskPrompt, schedule: { kind: 'cron', expr: '0 3 * * *' }, enabled: true, createdAt: '2026-03-28T00:00:00Z', updatedAt: '2026-03-28T00:00:00Z' })
  }

  it('is healthy with no Bakin jobs and with runnable prompts; flags each unrunnable job with a Remove job repair', async () => {
    expect(observations(await checkSchedulePrompts())[0]).toMatchObject({ key: 'prompts', status: 'healthy' })
    bakinJob('good', 'Post the daily recipe')
    expect(observations(await checkSchedulePrompts())[0]).toMatchObject({ status: 'healthy', summary: '1 Bakin schedule(s) carry a runnable task prompt.' })

    bakinJob('dream', '__openclaw_memory_core_short_term_promotion_dream__', 'dream')
    bakinJob('empty', undefined, 'Empty prompt')
    const rows = observations(await checkSchedulePrompts())
    expect(rows.map((r) => [r.key, r.status])).toEqual([['unrunnable-dream', 'error'], ['unrunnable-empty', 'error']])
    expect(rows[0]!.incident).toMatchObject({ resolution: { type: 'repair', actionId: 'remove-unrunnable-jobs', label: 'Remove job' } })
    expect(unrunnableBakinJobs().map((j) => j.jobId)).toEqual(['dream', 'empty'])
  })

  it('the plan freezes the exact job ids; apply removes ONLY those, skips what changed, never touches a job that appeared later', async () => {
    bakinJob('A', 'heartbeat')
    bakinJob('B', '')
    bakinJob('good', 'Post the daily recipe')
    const removed: string[] = []
    const repair = scheduleUnrunnableJobsRepair((jobId) => { removed.push(jobId) })
    const plan = await repair.plan(repairTarget)
    expect(plan).toHaveLength(1)
    expect(plan[0]!.safety).toBe('destructive')
    expect(plan[0]!.changes.map((c) => [c.kind, c.target, c.action])).toEqual([['file', 'A', 'delete'], ['file', 'B', 'delete']])

    // Between plan and apply: C appears (unrunnable) and B is fixed by hand.
    bakinJob('C', 'dream')
    bakinJob('B', 'Now a real prompt')

    const results = await repair.apply(plan)
    expect(results[0]).toMatchObject({ status: 'applied', affectedCheckIds: ['schedule.schedule-prompts'] })
    expect(results[0]!.changes.map((c) => c.target)).toEqual(['A'])
    expect(results[0]!.message).toContain('Removed 1 schedule(s): A.')
    expect(results[0]!.message).toContain('Skipped 1')
    expect(removed).toEqual(['A'])
    expect(getJob('A')).toBeNull()
    expect(getJob('B')).toMatchObject({ taskPrompt: 'Now a real prompt' })
    expect(getJob('C')).not.toBeNull()
    expect(getJob('good')).not.toBeNull()

    // The next cycle proposes exactly C.
    const next = await repair.plan(repairTarget)
    expect(next[0]!.changes.map((c) => c.target)).toEqual(['C'])
    // A re-applied stale plan (A already gone) is a skip, never an error.
    const again = await repair.apply(plan)
    expect(again[0]!.status).toBe('skipped')
  })
})

describe('checkScheduleSync - runtime failures', () => {
  it('warns when the runtime cron adapter cannot list jobs', async () => {
    runtimeError = new Error('adapter unavailable')
    const results = observations(await checkScheduleSync(cronReader))
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
    expect(checkIds).toContain('schedule-prompts')
    expect(actionIds).toContain('remove-unrunnable-jobs')

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
