/**
 * Re-homing table rows 145–150 (self-healing 1.7): the schedule-owned
 * families, their effects/mode, and each row's emitted shape.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-schedule-rehoming-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import type { CronJob } from '@bakin/core/adapters/runtime'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: pathJoin(testDir, 'bakin.db') }), isUsingBakinHome: () => true })
mock.module('@/core/content-dir', contentDirMock)
mock.module('@bakin/core/content-dir', contentDirMock)
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@bakin/core/main-agent', () => ({ getMainAgentId: () => 'main', tryGetMainAgentId: () => 'main', getMainAgentName: () => 'Main' }))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

import { repairMode } from '@bakin/core/health/repair-mode'
import {
  SCHEDULE_CUTOVER_INCIDENTS,
  SCHEDULE_PROMPTS_INCIDENTS,
  SCHEDULE_SYNC_INCIDENTS,
  checkScheduleCutover,
  checkSchedulePrompts,
  checkScheduleSync,
  scheduleCutoverRepair,
  scheduleSyncRepair,
  scheduleUnrunnableJobsRepair,
} from '../../../plugins/schedule/lib/health-checks'
import { getJob, upsertJob } from '../../../plugins/schedule/lib/sidecar'

type Row = { key: string; status: string; incident?: Record<string, unknown> & { resolution: Record<string, unknown> } }
function rows(result: { outcome: string }): Row[] {
  if (result.outcome !== 'observed') throw new Error(`expected observed, got ${result.outcome}`)
  return (result as unknown as { observations: Row[] }).observations
}
const cron = (jobs: CronJob[]) => ({ list: async () => jobs })
const failing = { list: async (): Promise<CronJob[]> => { throw new Error('runtime down') } }
const job = (id: string, command: string): CronJob => ({ id, name: id, schedule: '0 9 * * *', command, enabled: true })
const bakinJob = (jobId: string, taskPrompt: string | undefined) => upsertJob({
  jobId, isBakinJob: true, source: 'adopted', displayName: jobId, taskPrompt, schedule: { kind: 'cron', expr: '0 3 * * *' }, enabled: true,
  createdAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.000Z',
} as Parameters<typeof upsertJob>[0])

beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(pathJoin(testDir, 'schedule'), { recursive: true }) })
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('schedule re-homing catalogs (rows 145–150)', () => {
  it('declares exactly the families the table names; the read failures are observations', () => {
    expect(SCHEDULE_SYNC_INCIDENTS).toEqual([{ id: 'orphan', subjectKind: 'system', resolution: { type: 'repair', actionId: 'track-runtime-cron' }, required: 'always' }]) // 146 (145 observation)
    expect(SCHEDULE_CUTOVER_INCIDENTS).toEqual([{ id: 'lingering', subjectKind: 'system', resolution: { type: 'repair', actionId: 'complete-cutover' }, required: 'always' }]) // 148 (147 observation)
    expect(SCHEDULE_PROMPTS_INCIDENTS).toEqual([{ id: 'unrunnable', subjectKind: 'system', resolution: { type: 'repair', actionId: 'remove-unrunnable-jobs' }, required: 'owner-decides' }]) // 149/150
  })

  it('actions carry the table effects: tracking self-heals (a policy write); the two removals delete → one-click', () => {
    const track = scheduleSyncRepair(undefined, async () => 'main')
    expect(track.effects).toEqual({ deletesUserContent: false, spendsMoney: false, widensAuthorization: false })
    expect(repairMode(track.effects)).toBe('self-heal')
    expect(track.mutation).toBe('policy')
    for (const action of [scheduleCutoverRepair(async () => ({ migrated: 0, failed: 0 })), scheduleUnrunnableJobsRepair(() => {})]) {
      expect(action.effects).toEqual({ deletesUserContent: true, spendsMoney: false, widensAuthorization: false })
      expect(repairMode(action.effects)).toBe('one-click')
      expect(action.mutation).toBe('delete')
    }
  })
})

describe('schedule re-homing emissions', () => {
  it('145 runtime-cron and 147 cutover-verification are unknown observations when the runtime cannot be read', async () => {
    const [sync] = rows(await checkScheduleSync(failing))
    const [cutover] = rows(await checkScheduleCutover(failing, () => ['sch_a']))
    expect(sync).toMatchObject({ key: 'runtime-cron', status: 'unknown' })
    expect(sync!.incident).toBeUndefined()
    expect(cutover).toMatchObject({ key: 'cutover-verification', status: 'unknown' })
    expect(cutover!.incident).toBeUndefined()
  })

  it('146 orphan → self-heal track-runtime-cron on the job subject', async () => {
    const [row] = rows(await checkScheduleSync(cron([job('rogue', 'Post the daily recipe')])))
    expect(row!.incident).toMatchObject({ declarationId: 'orphan', disposition: 'action_required', subject: { kind: 'system', id: 'schedule:rogue' }, resolution: { type: 'repair', actionId: 'track-runtime-cron' } })
  })

  it('148 lingering → complete-cutover on the schedule subject', async () => {
    const [row] = rows(await checkScheduleCutover(cron([job('sch_a', 'x')]), () => ['sch_a']))
    expect(row).toMatchObject({ status: 'error' })
    expect(row!.incident).toMatchObject({ declarationId: 'lingering', subject: { kind: 'system', id: 'schedule:sch_a' }, resolution: { type: 'repair', actionId: 'complete-cutover' } })
  })

  it('149 an active unrunnable job is required (action_required); 150 a paused one is advisory and not required', async () => {
    bakinJob('active', 'heartbeat')
    bakinJob('paused', '')
    upsertJob({ ...getJob('paused')!, paused: true, pauseReason: 'unrunnable-prompt', enabled: false })
    const all = rows(await checkSchedulePrompts())
    const active = all.find((r) => r.key === 'unrunnable-active')
    const paused = all.find((r) => r.key === 'unrunnable-paused')
    expect(active).toMatchObject({ status: 'error' })
    expect(active!.incident).toMatchObject({ declarationId: 'unrunnable', required: true, disposition: 'action_required', subject: { kind: 'system', id: 'schedule:active' }, resolution: { type: 'repair', actionId: 'remove-unrunnable-jobs' } })
    expect(paused).toMatchObject({ status: 'warning' })
    expect(paused!.incident).toMatchObject({ declarationId: 'unrunnable', required: false, disposition: 'advisory', resolution: { type: 'repair', actionId: 'remove-unrunnable-jobs' } })
  })
})
