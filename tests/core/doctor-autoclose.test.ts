/**
 * Auto-close of Health repair requests (plan PR 2 T9, review R4): a task
 * closes only when every originating check EVALUATES healthy on a fresh
 * targeted run and no original incident remains. Each negative evidence
 * state (still failing, check failed, unknown, stale, unregistered) keeps
 * the task open — an absent incident alone never closes anything.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { healthError, healthHealthy, healthObserved, healthUnknown } from '@makinbakin/sdk/utils'

const testDir = join(tmpdir(), `bakin-test-doctor-autoclose-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)
mock.module('../../src/core/audit', () => ({ appendAudit: mock() }))
mock.module('../../src/core/onboarding/state', () => ({ isOnboarded: () => true }))
mock.module('../../src/core/settings', () => ({
  getSettings: () => ({
    doctor: { intervalMs: 60_000, checkTimeoutMs: 5_000, requireOnboard: false, escalation: true, sensitivity: 'developer' },
    approvals: { channelAlerts: false, channel: 'general', requireRejectReason: true },
  }),
  resetSettingsCache: () => {},
}))
mock.module('../../src/core/sse', () => ({ broadcast: () => {} }))
mock.module('../../src/core/app-services-store', () => ({ maybeGetAppServices: () => undefined, getAppServices: () => { throw new Error('no services') } }))

const tasks = new Map<string, { column: string; logs: string[] }>()
const moveTaskWithEffects = mock(async (taskId: string, to: string, _agent: string, _opts?: { skipDoneGuard?: boolean; channel?: string }) => { tasks.get(taskId)!.column = to; return { alreadyComplete: false } })
mock.module('../../src/core/task-service', () => ({
  moveTaskWithEffects,
  getTaskDetails: async (taskId: string) => tasks.has(taskId) ? { task: {}, column: tasks.get(taskId)!.column } : null,
}))
mock.module('../../src/core/task-store', () => ({
  addTaskLog: async (taskId: string, _author: string, message: string) => { tasks.get(taskId)?.logs.push(message) },
}))

import { createApprovalRecord, getApprovalRecord } from '../../packages/core/src/approvals'
import { applyHealthCheckRun, getHealthReport, resetHealthReportCache } from '../../src/core/doctor-report-cache'
import { runHealthCheck } from '../../src/core/doctor-checks'
import { resetDoctorFlightsForTests } from '../../src/core/doctor-execution'
import { createDoctorRepairRequest, getDoctorRepairRequest, updateDoctorRepairRequest } from '../../src/core/doctor-repair-store'
import { getHealthCheck, registerPluginHealthCheck, unregisterHealthCheck, unregisterPluginHealthChecks } from '../../src/core/health-check-registry'
import { checkEvaluatedHealthy, judgeRequest, reconcileRepairRequests, resetAutoCloseForTests, startAutoCloseWatcher } from '../../src/core/doctor-autoclose'
import { waitUntil } from '../helpers/wait'

type Mode = 'error' | 'healthy' | 'unknown' | 'throw'
let mode: Mode = 'error'

const INCIDENT_ID = 'autoclose-test:search:unavailable'
const CHECK_ID = 'autoclose-test.search'

function register() {
  registerPluginHealthCheck('autoclose-test', {
    id: 'search', name: 'Search', description: 'Search readiness.', group: { key: 'search', label: 'Search' },
    run: async () => {
      if (mode === 'throw') throw new Error('engine timed out')
      if (mode === 'unknown') return healthObserved([healthUnknown({ key: 'engine', summary: 'Cannot tell.', incident: { key: 'unknown', title: 'Search state unknown', impact: 'Unknown.', disposition: 'watch', resolution: { key: 'rerun', type: 'rerun', label: 'Re-run' } } })])
      if (mode === 'healthy') return healthObserved([healthHealthy({ key: 'engine', summary: 'Ready.' })])
      return healthObserved([healthError({
        key: 'engine', summary: 'Search is unavailable.',
        incident: { key: 'unavailable', title: 'Search is unavailable', impact: 'Search fails.', disposition: 'action_required', resolution: { key: 'restart', type: 'instructions', label: 'Restart', steps: ['bakin install search'] } },
      })])
    },
  }, 'Autoclose Test')
}

async function sweep(executionId = `exec-${randomUUID()}`) {
  applyHealthCheckRun(await runHealthCheck(getHealthCheck(CHECK_ID)!, { executionId: () => executionId }))
}

function openRequest(column = 'blocked', overrides: Partial<Parameters<typeof updateDoctorRepairRequest>[2] extends (r: infer R) => unknown ? R : never> = {}) {
  const taskId = `task-${randomUUID().slice(0, 6)}`
  tasks.set(taskId, { column, logs: [] })
  const request = createDoctorRepairRequest(testDir, { kind: 'delegate', incidentIds: [INCIDENT_ID], observationIds: [`${CHECK_ID}:engine`], checkIds: [CHECK_ID] })
  // Old enough to be eligible (requests younger than a minute are skipped).
  const createdAt = new Date(Date.now() - 5 * 60_000).toISOString()
  updateDoctorRepairRequest(testDir, request.id, (r) => ({ ...r, status: 'sent', taskId, createdAt, ...overrides }))
  return { requestId: request.id, taskId }
}

beforeEach(async () => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  resetHealthReportCache()
  resetDoctorFlightsForTests()
  resetAutoCloseForTests()
  tasks.clear()
  moveTaskWithEffects.mockClear()
  mode = 'error'
  register()
  await sweep()
  expect(getHealthReport().incidents.map((i) => i.id)).toEqual([INCIDENT_ID])
})

afterEach(() => {
  unregisterPluginHealthChecks('autoclose-test')
  unregisterHealthCheck('core.onboarded')
  rmSync(testDir, { recursive: true, force: true })
})

describe('checkEvaluatedHealthy', () => {
  it('is true only for an observed, current, all-healthy fresh run', async () => {
    expect(checkEvaluatedHealthy(getHealthReport(), CHECK_ID)).toBe(false)
    mode = 'healthy'
    await sweep()
    expect(checkEvaluatedHealthy(getHealthReport(), CHECK_ID)).toBe(true)
    expect(checkEvaluatedHealthy(getHealthReport(), 'nobody.registered')).toBe(false)
  })
})

describe('reconcileRepairRequests', () => {
  it('closes an open request from any column once its check runs healthy and the incident is gone', async () => {
    const blocked = openRequest('blocked')
    const review = openRequest('review')
    const todo = openRequest('todo')
    mode = 'healthy'

    const summary = await reconcileRepairRequests(testDir)
    expect(summary.checked).toBe(3)
    expect(summary.closed.sort()).toEqual([blocked.requestId, review.requestId, todo.requestId].sort())
    for (const { requestId, taskId } of [blocked, review, todo]) {
      expect(getDoctorRepairRequest(testDir, requestId)!.status).toBe('verified')
      expect(tasks.get(taskId)).toMatchObject({ column: 'done' })
      expect(tasks.get(taskId)!.logs.at(-1)).toContain('Verified by Health')
    }
    expect(moveTaskWithEffects.mock.calls.every((call) => call[2] === 'system' && call[3]?.skipDoneGuard === true)).toBe(true)
  })

  it('withdraws the pending approval of a closed approval request', async () => {
    const { requestId, taskId } = openRequest('review')
    createApprovalRecord({ approvalId: `health-repair:${requestId}`, owner: { kind: 'health-repair', taskId, requestId, incidentIds: [INCIDENT_ID], proposal: { reportId: 'r', observationIds: [], items: [] } }, request: { title: 'Repair', body: '', options: [{ id: 'apply', label: 'Apply' }] } })
    updateDoctorRepairRequest(testDir, requestId, (r) => ({ ...r, kind: 'approval-repair', approvalId: `health-repair:${requestId}` }))
    mode = 'healthy'
    await reconcileRepairRequests(testDir)
    expect(getApprovalRecord(`health-repair:${requestId}`)).toMatchObject({ status: 'cancelled', response: { comment: 'resolved' } })
    expect(tasks.get(taskId)!.column).toBe('done')
  })

  it('keeps the task while the incident still reproduces', async () => {
    const { requestId, taskId } = openRequest()
    const summary = await reconcileRepairRequests(testDir)
    expect(summary.closed).toEqual([])
    expect(summary.kept[0]).toMatchObject({ requestId, reason: `unhealthy: ${CHECK_ID}` })
    expect(getDoctorRepairRequest(testDir, requestId)!.status).toBe('sent')
    expect(tasks.get(taskId)!.column).toBe('blocked')
  })

  it('a check whose fresh run FAILED keeps the task open — last-known evidence is not a verification', async () => {
    const { requestId, taskId } = openRequest()
    mode = 'throw'
    const summary = await reconcileRepairRequests(testDir)
    expect(getHealthReport().checks.find((c) => c.checkId === CHECK_ID)?.latestExecution.outcome).toBe('failed')
    expect(summary.closed).toEqual([])
    expect(getDoctorRepairRequest(testDir, requestId)!.status).toBe('sent')
    expect(getDoctorRepairRequest(testDir, requestId)!.events.at(-1)?.message).toContain('did not evaluate healthy')
    expect(tasks.get(taskId)!.column).toBe('blocked')
  })

  it('an unknown-status observation keeps the task open', async () => {
    const { requestId } = openRequest()
    mode = 'unknown'
    await reconcileRepairRequests(testDir)
    expect(getDoctorRepairRequest(testDir, requestId)!.status).toBe('sent')
  })

  it('stale healthy evidence never verifies: the judgement reads the snapshot as last_known once its window passes', async () => {
    const { requestId } = openRequest()
    mode = 'healthy'
    await sweep()
    const fresh = getHealthReport()
    expect(checkEvaluatedHealthy(fresh, CHECK_ID)).toBe(true)
    const later = new Date(Date.parse(fresh.observations.find((o) => o.checkId === CHECK_ID)!.staleAt) + 1).toISOString()
    const stale = getHealthReport(later)
    expect(stale.observations.find((o) => o.checkId === CHECK_ID)?.snapshot).toBe('last_known')
    expect(checkEvaluatedHealthy(stale, CHECK_ID)).toBe(false)
    expect(judgeRequest(getDoctorRepairRequest(testDir, requestId)!, stale, [CHECK_ID]).verified).toBe(false)
  })

  it('an unregistered originating check keeps the task open', async () => {
    const { requestId } = openRequest()
    unregisterPluginHealthChecks('autoclose-test')
    const summary = await reconcileRepairRequests(testDir)
    expect(summary.kept[0]).toMatchObject({ requestId })
    expect(getDoctorRepairRequest(testDir, requestId)!.status).toBe('sent')
  })

  it('skips requests that are applying, verified, dismissed, closed, task-less or too young', async () => {
    mode = 'healthy'
    openRequest('blocked', { status: 'applying' })
    openRequest('blocked', { status: 'verified' })
    openRequest('blocked', { status: 'dismissed' })
    openRequest('done')
    openRequest('blocked', { taskId: undefined })
    openRequest('blocked', { createdAt: new Date().toISOString() })
    const summary = await reconcileRepairRequests(testDir)
    expect(summary.checked).toBe(0)
    expect(moveTaskWithEffects).not.toHaveBeenCalled()
  })

  it('derives the originating checks for pre-approvals requests that stored none', async () => {
    const { requestId, taskId } = openRequest('blocked', { checkIds: [] })
    mode = 'healthy'
    await reconcileRepairRequests(testDir)
    expect(getDoctorRepairRequest(testDir, requestId)!.status).toBe('verified')
    expect(tasks.get(taskId)!.column).toBe('done')
  })
})

describe('startAutoCloseWatcher', () => {
  it('reconciles once, debounced, when the incident set changes — and not on its own republish', async () => {
    const { requestId } = openRequest()
    const stop = startAutoCloseWatcher(testDir, { debounceMs: 5 })
    mode = 'healthy'
    await sweep()
    await waitUntil(() => getDoctorRepairRequest(testDir, requestId)!.status === 'verified', { label: 'debounced auto-close' })
    expect(moveTaskWithEffects).toHaveBeenCalledTimes(1)
    await sweep()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(moveTaskWithEffects).toHaveBeenCalledTimes(1)
    stop()
  })
})
