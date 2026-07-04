import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-cutover-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { migrateBakinSchedulesOffOpenClawCron, type CutoverDeps } from '@bakin/schedule/lib/cutover'
import { upsertJob, getJob, readSidecar } from '@bakin/schedule/lib/sidecar'
import type { BakinJobMeta } from '@bakin/schedule/types'

function seed(meta: Partial<BakinJobMeta> & { jobId: string }): void {
  upsertJob({
    isBakinJob: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...meta,
  })
}

/** Fake runtime cron with a known set of still-present jobs. */
function makeDeps(runtimeJobs: Record<string, { schedule: string; enabled?: boolean; metadata?: Record<string, unknown> }>) {
  const removed: string[] = []
  const deps: CutoverDeps = {
    cronGet: async (jobId) => runtimeJobs[jobId] ?? null,
    cronRemove: async (jobId) => { removed.push(jobId) },
    systemTz: () => 'America/Denver',
  }
  return { deps, removed }
}

describe('schedule/cutover', () => {
  beforeEach(() => mkdirSync(join(testDir, 'schedule'), { recursive: true }))
  afterEach(() => rmSync(testDir, { recursive: true, force: true }))

  it('imports expr/tz/enabled from the runtime cron, then removes it', async () => {
    seed({ jobId: 'sch_1', displayName: 'Daily', tz: undefined })
    const { deps, removed } = makeDeps({
      sch_1: { schedule: '0 9 * * *', enabled: true, metadata: { tz: 'America/New_York' } },
    })
    const summary = await migrateBakinSchedulesOffOpenClawCron(deps)
    expect(summary.migrated).toBe(1)
    expect(removed).toEqual(['sch_1'])
    const job = getJob('sch_1')!
    expect(job.schedule).toEqual({ kind: 'cron', expr: '0 9 * * *' })
    expect(job.tz).toBe('America/New_York')
    expect(job.enabled).toBe(true)
  })

  it('is idempotent: an already-migrated job (expr set, no runtime cron) is left alone', async () => {
    seed({ jobId: 'sch_1', schedule: { kind: 'cron', expr: '0 9 * * *' }, enabled: true })
    const { deps, removed } = makeDeps({}) // no runtime cron remains
    const summary = await migrateBakinSchedulesOffOpenClawCron(deps)
    expect(summary.alreadyMigrated).toBe(1)
    expect(summary.migrated).toBe(0)
    expect(removed).toEqual([])
  })

  it('keeps an already-stored expr but still removes a lingering runtime cron', async () => {
    seed({ jobId: 'sch_1', schedule: { kind: 'cron', expr: '30 8 * * *' } })
    const { deps, removed } = makeDeps({ sch_1: { schedule: '0 0 * * *' } })
    const summary = await migrateBakinSchedulesOffOpenClawCron(deps)
    expect(summary.migrated).toBe(1)
    expect(removed).toEqual(['sch_1'])
    expect(getJob('sch_1')!.schedule).toEqual({ kind: 'cron', expr: '30 8 * * *' }) // not overwritten
  })

  it('flags an unrecoverable job (no runtime cron and no stored expr)', async () => {
    seed({ jobId: 'sch_1' })
    const { deps, removed } = makeDeps({})
    const summary = await migrateBakinSchedulesOffOpenClawCron(deps)
    expect(summary.unrecoverable).toBe(1)
    expect(removed).toEqual([])
  })

  it('skips non-Bakin jobs', async () => {
    seed({ jobId: 'native_1', isBakinJob: false })
    const { deps } = makeDeps({ native_1: { schedule: '0 9 * * *' } })
    const summary = await migrateBakinSchedulesOffOpenClawCron(deps)
    expect(summary.checked).toBe(0)
    expect(readSidecar().jobs.native_1.isBakinJob).toBe(false)
  })

  it('records a failure when the runtime errors, without crashing the pass', async () => {
    seed({ jobId: 'sch_ok', schedule: { kind: 'cron', expr: '0 9 * * *' } })
    seed({ jobId: 'sch_err' })
    const removed: string[] = []
    const deps: CutoverDeps = {
      cronGet: async (jobId) => {
        if (jobId === 'sch_err') throw new Error('runtime unreachable')
        return null
      },
      cronRemove: async (jobId) => { removed.push(jobId) },
      systemTz: () => 'UTC',
    }
    const summary = await migrateBakinSchedulesOffOpenClawCron(deps)
    expect(summary.failed).toBe(1)
    expect(summary.alreadyMigrated).toBe(1) // sch_ok still fine
  })
})
