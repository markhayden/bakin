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
    const results = await checkScheduleSync(testDir, cronReader, 'main')
    expect(results).toHaveLength(1)
    expect(results[0].check).toBe('schedule-sync')
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/No runtime cron jobs/)
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

    const results = await checkScheduleSync(testDir, cronReader, 'main')
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/1 cron job\(s\), all tracked/)
  })

  it('warns about orphaned runtime cron jobs without autoFix', async () => {
    runtimeJobs = [makeCronJob({ id: 'orphan-1', name: 'rogue-cron' })]
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const results = await checkScheduleSync(testDir, cronReader, 'main')
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warn')
    expect(results[0].autoFixable).toBe(true)
    expect(results[0].message).toMatch(/Orphan runtime cron job "rogue-cron"/)
  })
})

describe('checkScheduleSync - repair', () => {
  it('does not track orphaned runtime cron jobs during diagnostics', async () => {
    runtimeJobs = [makeCronJob({ id: 'orphan-1', name: 'rogue-cron' })]
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const results = await checkScheduleSync(testDir, cronReader, 'boss')
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warn')

    const updated = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
    expect(updated.jobs['orphan-1']).toBeUndefined()
  })

  it('tracks orphaned runtime cron jobs in the sidecar through explicit repair without guessing the agent', async () => {
    runtimeJobs = [makeCronJob({ id: 'orphan-1', name: 'rogue-cron' })]
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const results = await checkScheduleSync(testDir, cronReader, 'boss')
    const repair = scheduleSyncRepair(testDir, cronReader, async () => 'boss')
    const plan = await repair.plan(results)
    expect(plan).toHaveLength(1)
    const applied = await repair.apply(plan)
    expect(results).toHaveLength(1)
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

    const results = await checkScheduleSync(testDir, cronReader, 'main')
    await scheduleSyncRepair(testDir, cronReader, async () => 'main').apply(
      await scheduleSyncRepair(testDir, cronReader, async () => 'main').plan(results),
    )
    expect(existsSync(sidecarPath)).toBe(true)
  })
})

describe('checkScheduleSync - runtime failures', () => {
  it('warns when the runtime cron adapter cannot list jobs', async () => {
    runtimeError = new Error('adapter unavailable')
    const results = await checkScheduleSync(testDir, cronReader, 'main')
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/Failed to read runtime cron jobs/)
  })
})

describe('plugin registration', () => {
  interface RegisteredDef {
    id: string
    run: () => Promise<Array<{ status: string; message: string }>>
    repair?: unknown
  }

  async function activateWithCtx(opts: { cron: boolean }): Promise<RegisteredDef[]> {
    const schedulePlugin = (await import('../../../plugins/schedule')).default
    const registered: RegisteredDef[] = []
    const noop = mock()
    const noopAsync = mock(async () => {})
    const ctx: Record<string, unknown> = {
      pluginId: 'schedule',
      runtime: {
        agents: { list: mock(async () => [{ id: 'main', name: 'Main', role: 'Orchestrator' }]) },
        ...(opts.cron
          ? { cron: { list: mock(async () => []), get: mock(async () => null), remove: noopAsync } }
          : {}),
      },
      registerRoute: noop, registerExecTool: noop, registerNav: noop,
      registerSlot: noop, registerSkill: noop, registerWorkflow: noop,
      registerNodeType: noop, registerNotificationChannel: noop,
      registerHealthCheck: (def: RegisteredDef) => { registered.push(def); return `schedule.${def.id}` },
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
    return registered
  }

  it('registers the schedule-sync orphan-cron check alongside schedule-cutover', async () => {
    // schedule-sync detects native runtime crons invisible to Bakin's sidecar
    // (e.g. created by an agent directly in the runtime). Its repair only
    // writes requireTriage sidecar entries — it must NEVER write runtime cron
    // state, which is what made the pre-#473 legacy sync check double-fire.
    // The obsolete main-session-wake repair stays gone.
    const registered = await activateWithCtx({ cron: true })
    const ids = registered.map(d => d.id)

    expect(ids).toContain('schedule-sync')
    expect(ids).toContain('schedule-cutover')
    expect(ids).not.toContain('schedule-legacy-cron-wake')

    const sync = registered.find(d => d.id === 'schedule-sync')!
    expect(sync.repair).toBeDefined()
    const rows = await sync.run()
    expect(rows.every(r => r.status === 'ok')).toBe(true)
  })

  it('registers schedule-sync as a no-op OK on cron-less runtimes (pi)', async () => {
    const registered = await activateWithCtx({ cron: false })
    const sync = registered.find(d => d.id === 'schedule-sync')
    expect(sync).toBeDefined()
    expect(sync!.repair).toBeUndefined()
    const rows = await sync!.run()
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('ok')
    expect(rows[0].message).toMatch(/no native cron/i)
  })
})

describe('schedule/checkScheduleCutover', () => {
  const cron = (ids: string[]) => ({ list: async () => ids.map(id => ({ id, name: id, schedule: '0 9 * * *', command: 'x', enabled: true })) as unknown as CronJob[] })

  it('is ok when no Bakin schedule has a backing runtime cron', async () => {
    const rows = await checkScheduleCutover(cron(['native-1']), () => ['sch_a', 'sch_b'])
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('ok')
  })

  it('warns (auto-fixable) for a Bakin schedule still backed by a runtime cron', async () => {
    const rows = await checkScheduleCutover(cron(['sch_a', 'native-1']), () => ['sch_a', 'sch_b'])
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('warn')
    expect(rows[0].autoFixable).toBe(true)
    expect(rows[0].message).toContain('sch_a')
  })

  it('reports a warning when the runtime cannot be read', async () => {
    const failing = { list: async () => { throw new Error('runtime down') } }
    const rows = await checkScheduleCutover(failing, () => ['sch_a'])
    expect(rows[0].status).toBe('warn')
  })
})
