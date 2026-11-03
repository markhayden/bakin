/**
 * `schedule.workflowsScheduled` (self-healing PR1, Codex r1 #11): the ONE
 * "scheduled" fact the workflows health checks fold into their in-use
 * predicate (re-homing rows 133–137) — enabled Bakin jobs that target a
 * workflow; a paused job still counts, a disabled or completed one does not.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-schedule-wf-hook-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = `${testDir}-openclaw`

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), schedule: join(testDir, 'schedule') }), isUsingBakinHome: () => true })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => `${testDir}-openclaw`, getOpenClawPath: (...p: string[]) => join(`${testDir}-openclaw`, ...p), resetOpenClawHome: () => {} }))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

import { scheduledWorkflowIds } from '../../../plugins/schedule/lib/job-service'

const job = (jobId: string, over: Record<string, unknown>) => ({ jobId, isBakinJob: true, createdAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.000Z', schedule: { kind: 'cron', expr: '0 9 * * *' }, ...over })

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(join(testDir, 'schedule'), { recursive: true })
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('scheduledWorkflowIds', () => {
  it('names the workflows enabled Bakin jobs target — paused included, disabled/completed/runtime-owned/no-workflow excluded, deduped and sorted', () => {
    writeFileSync(join(testDir, 'schedule', 'sidecar.json'), JSON.stringify({ version: 1, jobs: {
      a: job('a', { workflowId: 'nightly' }),
      b: job('b', { workflowId: 'nightly' }),
      c: job('c', { workflowId: 'weekly', paused: true, pauseReason: 'manual' }),
      d: job('d', { workflowId: 'disabled-one', enabled: false }),
      e: job('e', { workflowId: 'done-one', schedule: { kind: 'at', expr: '2026-10-01T00:00:00.000Z' }, enabled: false, completedAt: '2026-10-01T00:00:00.000Z' }),
      f: job('f', { workflowId: 'runtime-one', isBakinJob: false }),
      g: job('g', { taskPrompt: 'no workflow here' }),
      h: job('h', { workflowId: 'alpha' }),
    } }))
    expect(scheduledWorkflowIds()).toEqual({ workflowIds: ['alpha', 'nightly', 'weekly'] })
  })

  it('no sidecar, or one that does not parse, schedules nothing (never a guess)', () => {
    expect(scheduledWorkflowIds()).toEqual({ workflowIds: [] })
    writeFileSync(join(testDir, 'schedule', 'sidecar.json'), '{ nope')
    expect(scheduledWorkflowIds()).toEqual({ workflowIds: [] })
  })
})
