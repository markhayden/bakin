/**
 * Bakin schedules survive a runtime switch (PR1 T4) — the core promise of the
 * Bakin-owned scheduler: the sidecar store + execution ledger are runtime-
 * independent, so switching adapters (either direction) must leave schedules
 * in place, ticking, and firing exactly once per occurrence. Also covers
 * --adopt-cron: a native OpenClaw cron becomes a Bakin schedule at switch
 * time and fires from the Bakin tick afterwards, while OpenClaw's internal
 * marker crons (no task prompt) are REFUSED and stay native (spec D5); and
 * switching back runs the cutover so an adopted job never has two fire paths.
 *
 * Real switchRuntime over real adapters with temp homes (same scaffolding as
 * runtime-switch.test.ts), real sidecar reads, real ledger claims. The fire
 * callback is a recorder — task creation is schedule-plugin-internal and
 * pinned by the schedule suite; survival is about store + claim integrity.
 */
import { join as pathJoin } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-sched-survival-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')
process.env.PI_HOME = pathJoin(testDir, 'pi')

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'

const contentDirFactory = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    db: pathJoin(testDir, 'bakin.db'),
    settings: pathJoin(testDir, 'settings.json'),
    tasks: pathJoin(testDir, 'tasks'),
    logs: pathJoin(testDir, 'logs'),
  }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
})
mock.module('../../src/core/content-dir', contentDirFactory)
mock.module('../../packages/core/src/content-dir', contentDirFactory)
const loggerFactory = () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
})
mock.module('../../src/core/logger', loggerFactory)
mock.module('../../packages/core/src/logger', loggerFactory)
mock.module('@bakin/core/logger', loggerFactory)
mock.module('../../src/core/watcher', () => ({ startWatcher: () => {}, stopWatcher: () => {} }))
mock.module('../../src/core/agent-packages/sync-scanner', () => ({
  scanAgentSync: async () => ({ findings: [], agentsScanned: 0, blocksOk: 0, projectionsOk: 0 }),
}))

import { switchRuntime } from '../../src/core/runtime-switch'
import { getSettings, resetSettingsCache, updateSettings } from '../../src/core/settings'
import { closeDb } from '../../packages/core/src/storage/db'
import { resetOpenClawConfigCache } from '../../packages/adapter-openclaw/src/config'
import { resetPiHome } from '../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../packages/adapter-pi/src/models'
import { getHookRegistry } from '../../packages/core/src/hooks/hook-registry-singleton'
import { installCliShim } from '../../dev/imitation-crab/cli-shim-install'
import { getCronFire, claimCronFire } from '../../src/core/execution-ledger'
import { runSchedulerTick, type SchedulerDeps } from '../../plugins/schedule/lib/scheduler'
import { readSidecar, upsertJob } from '../../plugins/schedule/lib/sidecar'
import { adoptCronJobs, type AdoptCronJobsInput } from '../../plugins/schedule/lib/cron-adoption'
import { migrateBakinSchedulesOffOpenClawCron } from '../../plugins/schedule/lib/cutover'
import { maybeGetAppServices } from '../../src/core/app-services-store'
import type { BakinJobMeta } from '../../plugins/schedule/types'

const openclawHome = pathJoin(testDir, 'openclaw')

function seedOpenClawHome(): void {
  mkdirSync(openclawHome, { recursive: true })
  writeFileSync(pathJoin(openclawHome, 'openclaw.json'), JSON.stringify({
    agents: {
      defaults: { model: { primary: 'openai/gpt-test-text' } },
      list: [{ id: 'main', identity: { name: 'Main', emoji: '🐾' } }],
    },
  }, null, 2))
  resetOpenClawConfigCache()
}

/** Native OpenClaw crons in the on-disk store the CLI shim + adapter read. */
function seedNativeCrons(jobs: Array<{ id: string; name: string; expr: string; message: string }>): void {
  mkdirSync(pathJoin(openclawHome, 'cron'), { recursive: true })
  writeFileSync(pathJoin(openclawHome, 'cron', 'jobs.json'), JSON.stringify({
    version: 1,
    jobs: jobs.map((job) => ({
      id: job.id,
      name: job.name,
      schedule: { kind: 'cron', expr: job.expr, tz: 'America/Denver' },
      enabled: true,
      delivery: { mode: 'none' },
      payload: { message: job.message },
      createdAt: '2026-06-01T00:00:00Z',
    })),
  }, null, 2))
}

function nativeCronIds(): string[] {
  const path = pathJoin(openclawHome, 'cron', 'jobs.json')
  if (!existsSync(path)) return []
  return (JSON.parse(readFileSync(path, 'utf-8')) as { jobs: Array<{ id: string }> }).jobs.map((job) => job.id).sort()
}

function scheduleMeta(jobId: string, expr: string): BakinJobMeta {
  return {
    jobId,
    isBakinJob: true,
    enabled: true,
    schedule: { kind: 'cron', expr },
    tz: 'America/Denver',
    displayName: 'Survivor',
    taskPrompt: 'do the daily thing',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  }
}

/** Real-ledger tick: real sidecar jobs, real (job,run) claims, recorder fire. */
async function tickAt(nowMs: number): Promise<Array<{ jobId: string; runId: string }>> {
  const fired: Array<{ jobId: string; runId: string }> = []
  const deps: SchedulerDeps = {
    now: () => nowMs,
    tickWindowMs: 90_000,
    listJobs: () => Object.values(readSidecar().jobs).filter((job) => job.isBakinJob),
    getCronFire: (jobId, runId) => getCronFire(jobId, runId),
    claimCronFire: (jobId, runId, firedAt) => claimCronFire(jobId, runId, firedAt),
    fire: async (_meta, jobId, runId) => { fired.push({ jobId, runId }) },
  }
  await runSchedulerTick(deps)
  return fired
}

// 9:00:30am America/Denver (MDT, UTC-6) on successive days — 30s inside the
// tick window after the 9am occurrence.
const DAY1_TICK = Date.parse('2026-06-07T15:00:30Z')
const DAY2_TICK = Date.parse('2026-06-08T15:00:30Z')
const DAY3_TICK = Date.parse('2026-06-09T15:00:30Z')
const DAY4_TICK = Date.parse('2026-06-10T15:00:30Z')
const DAY5_TICK = Date.parse('2026-06-11T15:00:30Z')

let unregisterAdoptHook: (() => void) | null = null

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  seedOpenClawHome()
  // The OpenClaw adapter shells this binary for cron CRUD — point it at the
  // crab CLI shim via the adapter-private runtime settings (initialize()
  // threads settings.runtime.settings; the env-var default is evaluated at
  // module load, before this file's statements run).
  const shimPath = installCliShim(testDir)
  resetSettingsCache()
  updateSettings({
    runtime: { adapter: 'openclaw', settings: { binaryPath: shimPath } },
    search: { settings: { enabled: false } },
  })

  // The schedule plugin isn't activated in this harness — register its real
  // adoption handler the way activate() does, with a minimal ctx.
  const adoptCtx = {
    runtime: { agents: { list: async () => [{ id: 'main', name: 'Main', role: 'Orchestrator' }] } },
    activity: { log: () => {}, audit: () => {} },
  }
  unregisterAdoptHook = getHookRegistry().register(
    'schedule.adoptCronJobs',
    (data: unknown) => adoptCronJobs(adoptCtx as never, data as AdoptCronJobsInput),
    'schedule',
  )
})

afterAll(() => {
  unregisterAdoptHook?.()
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
  resetSettingsCache()
  resetPiHome()
  resetModelRegistry()
})

describe('Bakin schedules survive a runtime switch', () => {
  it('fires before the switch (baseline, exactly once)', async () => {
    upsertJob(scheduleMeta('sch_survivor', '0 9 * * *'))
    const fired = await tickAt(DAY1_TICK)
    expect(fired).toEqual([{ jobId: 'sch_survivor', runId: expect.stringContaining('sch_survivor:') }])
    // Re-tick of the same window is a ledger no-op.
    expect(await tickAt(DAY1_TICK)).toEqual([])
  })

  it('openclaw → pi: schedule intact, next occurrence fires exactly once', async () => {
    const result = await switchRuntime('pi', { copyWorkspaces: false })
    expect(result.ok).toBe(true)
    expect(getSettings().runtime.adapter).toBe('pi')

    const job = readSidecar().jobs['sch_survivor']
    expect(job).toBeDefined()
    expect(job.schedule).toEqual({ kind: 'cron', expr: '0 9 * * *' })
    expect(job.enabled).toBe(true)

    const fired = await tickAt(DAY2_TICK)
    expect(fired).toHaveLength(1)
    expect(fired[0].jobId).toBe('sch_survivor')
    expect(await tickAt(DAY2_TICK)).toEqual([])
  })

  it('pi → openclaw: schedule still intact, still firing', async () => {
    const result = await switchRuntime('openclaw', { copyWorkspaces: false })
    expect(result.ok).toBe(true)
    expect(getSettings().runtime.adapter).toBe('openclaw')

    expect(readSidecar().jobs['sch_survivor']).toBeDefined()
    const fired = await tickAt(DAY3_TICK)
    expect(fired).toHaveLength(1)
    expect(fired[0].jobId).toBe('sch_survivor')
  })

  it('openclaw → pi with --adopt-cron: real crons are adopted, marker crons are refused (dry run and real), nothing leaks', async () => {
    // The margo shape: a real schedule beside OpenClaw's own internal markers.
    seedNativeCrons([
      { id: 'native-daily', name: 'Native Daily', expr: '0 9 * * *', message: 'do the native thing' },
      { id: 'heartbeat', name: 'heartbeat', expr: '*/30 * * * *', message: '' },
      { id: 'dream', name: 'dream', expr: '0 3 * * *', message: '__openclaw_memory_core_short_term_promotion_dream__' },
    ])

    // Dry run first: the listing tells the truth and writes nothing.
    const preview = await switchRuntime('pi', { copyWorkspaces: false, adoptCron: true, dryRun: true })
    expect(preview.ok).toBe(true)
    expect(preview.cron!.listing.map((row) => [row.jobId, row.outcome]).sort()).toEqual([
      ['dream', 'refuse'], ['heartbeat', 'refuse'], ['native-daily', 'adopt'],
    ])
    expect(preview.cron!.refused.map((r) => r.reason)).toEqual([expect.stringContaining('not a task prompt'), expect.stringContaining('not a task prompt')])
    expect(preview.cantCarry?.find((line) => line.concern === 'cron')?.detail).toContain('2 refused: not a task prompt')
    expect(readSidecar().jobs['native-daily']).toBeUndefined()
    expect(getSettings().runtime.adapter).toBe('openclaw')

    const result = await switchRuntime('pi', { copyWorkspaces: false, adoptCron: true })
    expect(result.ok).toBe(true)

    const adoption = result.cron
    expect(adoption).not.toBeNull()
    expect(adoption!.adopted).toEqual(['native-daily'])
    expect(adoption!.refused.map((r) => r.jobId).sort()).toEqual(['dream', 'heartbeat'])
    expect(adoption!.failed).toEqual([])
    // Markers never become Bakin schedules — nothing for the scheduler to fail on.
    expect(readSidecar().jobs['dream']).toBeUndefined()
    expect(readSidecar().jobs['heartbeat']).toBeUndefined()

    const adopted = readSidecar().jobs['native-daily']
    expect(adopted).toBeDefined()
    expect(adopted.isBakinJob).toBe(true)
    expect(adopted.source).toBe('adopted')
    expect(adopted.schedule?.expr).toBe('0 9 * * *')
    expect(adopted.originalRuntimeCron).toBeDefined()

    // The native job's tz must survive adoption (metadata.tz from the
    // adapter) — NOT be replaced by the system timezone.
    expect(adopted.tz).toBe('America/Denver')

    // Both the survivor and the adopted job fire from the Bakin tick now.
    const fired = await tickAt(DAY4_TICK)
    expect(fired.map((f) => f.jobId).sort()).toEqual(['native-daily', 'sch_survivor'])
    expect(await tickAt(DAY4_TICK)).toEqual([])
  })

  it('pi → openclaw: the cutover removes the adopted job\'s native cron, markers stay native, every schedule fires once', async () => {
    const result = await switchRuntime('openclaw', { copyWorkspaces: false })
    expect(result.ok).toBe(true)
    // The native file still lists everything: the adopted job would have TWO
    // fire paths without the cutover the schedule plugin runs at activate.
    expect(nativeCronIds()).toEqual(['dream', 'heartbeat', 'native-daily'])

    const cron = maybeGetAppServices()?.runtime.cron
    expect(cron).toBeDefined()
    const summary = await migrateBakinSchedulesOffOpenClawCron({
      cronGet: async (jobId) => {
        const job = await cron!.get(jobId)
        return job ? { schedule: job.schedule, enabled: job.enabled, metadata: job.metadata } : null
      },
      cronRemove: async (jobId) => { await cron!.remove(jobId) },
      systemTz: () => 'UTC',
    })
    expect(summary.migrated).toBe(1)
    expect(summary.failed).toBe(0)
    // Only the adopted job's native cron is gone; the refused markers stay native.
    expect(nativeCronIds()).toEqual(['dream', 'heartbeat'])
    expect(readSidecar().jobs['native-daily']?.schedule?.expr).toBe('0 9 * * *')

    const fired = await tickAt(DAY5_TICK)
    expect(fired.map((f) => f.jobId).sort()).toEqual(['native-daily', 'sch_survivor'])
    expect(await tickAt(DAY5_TICK)).toEqual([])
  })
})
