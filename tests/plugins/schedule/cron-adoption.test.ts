/**
 * Switch-time cron adoption (pi-parity T3.4): snapshotted source cron jobs
 * become Bakin-managed schedules — source 'adopted', provider-raw snapshot
 * preserved, idempotent per job id, dry-run writes nothing.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-cron-adoption-${Date.now()}`)

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
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
// Search indexing is fire-and-forget noise here.
mock.module('@bakin/schedule/lib/job-service', () => ({
  indexJob: () => {},
}))

import { adoptCronJobs } from '@bakin/schedule/lib/cron-adoption'
import { getJob, upsertJob } from '@bakin/schedule/lib/sidecar'

const auditCalls: Array<{ event: string }> = []
const ctx = {
  runtime: {
    agents: { list: async () => [{ id: 'main', name: 'Main', role: 'orchestrator' }] },
  },
  activity: {
    audit: (event: string) => { auditCalls.push({ event }) },
    log: () => {},
  },
} as unknown as Parameters<typeof adoptCronJobs>[0]

const jobs = [
  { job: { id: 'daily-report', name: 'Daily report', schedule: '0 9 * * *', command: 'Post the daily report', enabled: true }, raw: { provider: 'openclaw', blob: 'x' } },
  { job: { id: 'weekly-clean', name: 'Weekly cleanup', schedule: '0 8 * * 1', command: 'Clean the library', enabled: false }, raw: { provider: 'openclaw', blob: 'y' } },
]

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  auditCalls.length = 0
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('adoptCronJobs', () => {
  it('adopts snapshotted jobs as Bakin schedules with the raw snapshot preserved', async () => {
    const result = await adoptCronJobs(ctx, { provider: 'openclaw', jobs })
    expect(result.adopted.sort()).toEqual(['daily-report', 'weekly-clean'])
    expect(result.failed).toEqual([])

    const meta = getJob('daily-report')
    expect(meta?.isBakinJob).toBe(true)
    expect(meta?.source).toBe('adopted')
    expect(meta?.schedule).toEqual({ kind: 'cron', expr: '0 9 * * *' })
    expect(meta?.taskPrompt).toBe('Post the daily report')
    expect(meta?.owner).toBe('main')
    expect(meta?.originalRuntimeCron?.provider).toBe('openclaw')
    expect(meta?.originalRuntimeCron?.snapshot).toEqual({ provider: 'openclaw', blob: 'x' })
    // Enabled state carries per job.
    expect(getJob('weekly-clean')?.enabled).toBe(false)
    expect(auditCalls.filter((c) => c.event === 'job.adopted')).toHaveLength(2)
  })

  it("preserves the native job's timezone over the system timezone", async () => {
    // Adapters hoist the provider schedule tz into metadata.tz; losing it
    // shifts an adopted evening job by hours on a UTC-configured box.
    const tzJobs = [{
      job: { id: 'evening-post', name: 'Evening post', schedule: '30 21 * * *', command: 'Post it', enabled: true, metadata: { tz: 'America/Denver' } },
      raw: { blob: 'z' },
    }]
    const result = await adoptCronJobs(ctx, { provider: 'openclaw', jobs: tzJobs })
    expect(result.adopted).toEqual(['evening-post'])
    expect(getJob('evening-post')?.tz).toBe('America/Denver')
  })

  it('is idempotent: already-Bakin jobs are skipped, never overwritten', async () => {
    upsertJob({
      jobId: 'daily-report',
      isBakinJob: true,
      source: 'bakin',
      displayName: 'User-tuned name',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    })
    const result = await adoptCronJobs(ctx, { provider: 'openclaw', jobs })
    expect(result.skipped).toEqual(['daily-report'])
    expect(result.adopted).toEqual(['weekly-clean'])
    expect(getJob('daily-report')?.displayName).toBe('User-tuned name')
    expect(getJob('daily-report')?.source).toBe('bakin')
  })

  it('dry run classifies identically but writes nothing', async () => {
    const result = await adoptCronJobs(ctx, { provider: 'openclaw', jobs, dryRun: true })
    expect(result.adopted.sort()).toEqual(['daily-report', 'weekly-clean'])
    expect(getJob('daily-report')).toBeFalsy()
    expect(auditCalls).toEqual([])
  })
})
