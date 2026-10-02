/**
 * Health approval kinds (plan PR 2 T7): opening a repair/navigate approval
 * (review task, request, record), Apply with the frozen-proposal guard (R1:
 * delayed approval, plan changed, nothing left), Dismiss (snooze/ack + task
 * done), simultaneous decisions, apply failure, and recovery of a request
 * interrupted mid-apply. Real report cache, real repair action, real stores.
 */
import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { healthError, healthHealthy, healthObserved, healthUnknown } from '@makinbakin/sdk/utils'
import type { HealthRepairPlanItem } from '@makinbakin/sdk/types'

const testDir = join(tmpdir(), `bakin-test-doctor-approvals-${Date.now()}-${randomUUID()}`)
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
    doctor: { intervalMs: 60_000, requireOnboard: false, escalation: true, sensitivity: 'developer' },
    approvals: { channelAlerts: false, channel: 'general', requireRejectReason: true },
  }),
  resetSettingsCache: () => {},
}))
const broadcasts: Array<Record<string, unknown>> = []
mock.module('../../src/core/sse', () => ({ broadcast: (d: Record<string, unknown>) => { broadcasts.push(d) } }))
mock.module('../../src/core/app-services-store', () => ({ maybeGetAppServices: () => undefined, getAppServices: () => { throw new Error('no services') } }))

const tasks = new Map<string, { column: string; blockedReason?: string; logs: string[] }>()
let nextTask = 0
const createTaskWithEffects = mock(async (opts: { column?: string }) => {
  const id = `task-${++nextTask}`
  tasks.set(id, { column: opts.column ?? 'todo', logs: [] })
  return { id }
})
const moveTaskWithEffects = mock(async (taskId: string, to: string) => {
  tasks.get(taskId)!.column = to
  return { alreadyComplete: false }
})
mock.module('../../src/core/task-service', () => ({ createTaskWithEffects, moveTaskWithEffects }))
mock.module('../../src/core/task-store', () => ({
  addTaskLog: async (taskId: string, _author: string, message: string) => { tasks.get(taskId)?.logs.push(message) },
  blockTask: async (taskId: string, reason: string) => { const t = tasks.get(taskId)!; t.column = 'blocked'; t.blockedReason = reason },
}))

import { getApprovalRecord, listApprovalRecords } from '../../packages/core/src/approvals'
import { clearApprovalKinds } from '../../src/core/approvals/kinds'
import { resolveApproval } from '../../src/core/approvals/service'
import { ApprovalNotPendingError, ApprovalResolveError } from '../../src/core/approvals/errors'
import { applyHealthCheckRun, getHealthReport, resetHealthReportCache } from '../../src/core/doctor-report-cache'
import { runHealthCheck } from '../../src/core/doctor-checks'
import { clearStoredRepairPlans, PLAN_TTL_MS } from '../../src/core/doctor-repair-plans'
import { planDoctorRepair } from '../../src/core/doctor-repair'
import { getDoctorRepairRequest, updateDoctorRepairRequest } from '../../src/core/doctor-repair-store'
import { readAckRecords } from '../../src/core/health-acks'
import {
  getHealthCheck,
  registerPluginHealthCheck,
  registerPluginHealthRepairAction,
  unregisterHealthCheck,
  unregisterPluginHealthChecks,
} from '../../src/core/health-check-registry'
import {
  canonicalChangeSet,
  healthRepairApprovalKind,
  openNavigateApproval,
  openRepairApproval,
  pendingRepairApprovalFor,
  recoverInterruptedApplies,
  registerDoctorApprovalKinds,
  sameChangeSet,
} from '../../src/core/doctor-approvals'

let unhealthy = true
let navigateUnhealthy = true
let planTarget = 'search-index'
let applyThrows: string | null = null
let applyLeavesUnhealthy = false
/** After apply the search check answers this way instead of healthy (R4 probes). */
let postApplyMode: 'unknown' | 'throw' | null = null
const applyAction = mock(async (items: HealthRepairPlanItem[]) => {
  if (applyThrows) throw new Error(applyThrows)
  if (!applyLeavesUnhealthy) unhealthy = false
  return items.map((item) => ({ itemId: item.id, actionId: item.actionId, status: 'applied' as const, message: 'Rebuilt the search index.', affectedCheckIds: ['approvals-test.search'], changes: item.changes }))
})
const web = { source: 'web' as const, id: 'mark' }
const channel = { source: 'channel' as const, id: 'u-1', displayName: 'Owner' }

async function refresh(executionId = `exec-${randomUUID()}`) {
  for (const id of ['approvals-test.search', 'approvals-test.auth']) {
    const def = getHealthCheck(id)
    if (def) applyHealthCheckRun(await runHealthCheck(def, { executionId: () => executionId }))
  }
}

async function seed() {
  registerPluginHealthRepairAction('approvals-test', {
    id: 'rebuild-index',
    name: 'Rebuild search index',
    plan: async () => [{
      id: 'rebuild', actionId: 'rebuild-index', title: 'Rebuild search index', reason: 'The index is corrupt.', safety: 'destructive',
      incidentIds: [], observationIds: [], preconditions: [],
      changes: [{ kind: 'file', target: planTarget, action: 'delete', description: 'Drop and rebuild the search index.' }],
    }],
    apply: applyAction,
  })
  registerPluginHealthCheck('approvals-test', {
    id: 'search', name: 'Search index', description: 'Checks the search index.', group: { key: 'search', label: 'Search' },
    run: async () => {
      if (postApplyMode === 'throw') throw new Error('engine timed out')
      if (postApplyMode === 'unknown') return healthObserved([healthUnknown({ key: 'index', summary: 'Cannot read the index.', incident: { key: 'unreadable', title: 'Search index state unknown', impact: 'Unknown.', disposition: 'watch', resolution: { key: 'rerun', type: 'rerun', label: 'Re-run' } } })])
      return healthObserved(unhealthy ? [healthError({
      key: 'index', summary: 'Search index is corrupt.',
      incident: { key: 'corrupt', title: 'Search index is corrupt', impact: 'Search returns nothing.', disposition: 'action_required', resolution: { key: 'rebuild', type: 'repair', label: 'Rebuild', actionId: 'rebuild-index' } },
    })] : [healthHealthy({ key: 'index', summary: 'Search index is ready.' })])
    },
  }, 'Approvals Test')
  registerPluginHealthCheck('approvals-test', {
    id: 'auth', name: 'Provider auth', description: 'Checks provider credentials.', group: { key: 'runtime', label: 'Runtime' },
    run: async () => healthObserved(navigateUnhealthy ? [healthError({
      key: 'openai', summary: 'OpenAI auth expired.',
      incident: { key: 'expired', title: 'OpenAI auth expired', impact: 'Turns on OpenAI models fail.', disposition: 'action_required', resolution: { key: 'login', type: 'navigate', label: 'Renew the key', href: '/settings?tab=integrations' } },
    })] : [healthHealthy({ key: 'openai', summary: 'OpenAI auth is valid.' })]),
  }, 'Approvals Test')
  await refresh('exec-1')
}

async function openRepair() {
  const report = getHealthReport()
  const incident = report.incidents.find((row) => row.id.includes('corrupt'))!
  const plan = await planDoctorRepair({ contentDir: testDir, projectRoot: testDir, target: { type: 'incidents', reportId: report.id, ids: [incident.id] } })
  return { ...(await openRepairApproval({ contentDir: testDir, report, incidents: [incident], items: plan.items, plan })), incident, plan }
}

beforeEach(async () => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  resetHealthReportCache()
  clearStoredRepairPlans()
  clearApprovalKinds()
  registerDoctorApprovalKinds({ contentDir: testDir, projectRoot: testDir })
  tasks.clear()
  nextTask = 0
  broadcasts.length = 0
  unhealthy = true
  navigateUnhealthy = true
  planTarget = 'search-index'
  applyThrows = null
  applyLeavesUnhealthy = false
  postApplyMode = null
  applyAction.mockClear()
  createTaskWithEffects.mockClear()
  await seed()
})

afterEach(() => {
  setSystemTime()
  unregisterPluginHealthChecks('approvals-test')
  unregisterHealthCheck('core.onboarded')
  rmSync(testDir, { recursive: true, force: true })
})

describe('change-set identity (R1)', () => {
  it('is order-independent and keyed on action + kind + target + action verb', () => {
    const a = [{ actionId: 'x', changes: [{ kind: 'file', target: 'b', action: 'delete', description: '1' }, { kind: 'file', target: 'a', action: 'delete', description: '2' }] }]
    const b = [{ actionId: 'x', changes: [{ kind: 'file', target: 'a', action: 'delete', description: 'other words' }, { kind: 'file', target: 'b', action: 'delete', description: '' }] }]
    expect(canonicalChangeSet(a)).toEqual(['x|file|a|delete', 'x|file|b|delete'])
    expect(sameChangeSet(a, b)).toBe(true)
    expect(sameChangeSet(a, [{ actionId: 'x', changes: [{ kind: 'file', target: 'a', action: 'delete', description: '' }] }])).toBe(false)
  })
})

describe('opening approvals', () => {
  it('a repair approval = one unassigned review task + a request with the frozen proposal + a pending record', async () => {
    const opened = await openRepair()
    expect(createTaskWithEffects.mock.calls[0]?.[0]).toMatchObject({ column: 'review', createdBy: 'system', source: { pluginId: 'health', entityId: opened.request.id, purpose: 'approval-repair' } })
    expect((createTaskWithEffects.mock.calls[0]?.[0] as { assignee?: string }).assignee).toBeUndefined()
    expect(opened.request).toMatchObject({ kind: 'approval-repair', status: 'sent', taskId: 'task-1', approvalId: `health-repair:${opened.request.id}`, checkIds: ['approvals-test.search'] })
    expect(opened.request.proposal).toMatchObject({ observationIds: ['approvals-test.search:index'], items: [{ actionId: 'approvals-test.rebuild-index', safety: 'destructive', changes: [{ kind: 'file', target: 'search-index', action: 'delete' }] }] })
    expect(opened.approval.status).toBe('pending')
    expect(opened.approval.owner).toMatchObject({ kind: 'health-repair', taskId: 'task-1', requestId: opened.request.id, incidentIds: [opened.incident.id] })
    expect(opened.approval.request.options.map((o) => o.id)).toEqual(['apply', 'dismiss'])
    expect(opened.approval.request.body).toContain('delete file `search-index`')
    expect(broadcasts.filter((b) => b.event === 'approval.pending')).toHaveLength(1)
  })

  it('a navigate approval carries the href and offers Dismiss only', async () => {
    const report = getHealthReport()
    const incident = report.incidents.find((row) => row.id.includes('expired'))!
    const opened = await openNavigateApproval({ contentDir: testDir, report, incident })
    expect(opened.request).toMatchObject({ kind: 'approval-navigate', status: 'sent', checkIds: ['approvals-test.auth'] })
    expect(opened.request.plan).toBeUndefined()
    expect(opened.approval.owner).toMatchObject({ kind: 'health-navigate', href: '/settings?tab=integrations' })
    expect(opened.approval.request.options.map((o) => o.id)).toEqual(['dismiss'])
    expect(opened.approval.request.body).toContain('/settings?tab=integrations')
  })
})

describe('health-repair: apply', () => {
  it('applies the frozen proposal when fresh planning agrees, verifies, completes the task — even long after the plan TTL', async () => {
    const opened = await openRepair()
    setSystemTime(new Date(Date.now() + PLAN_TTL_MS * 3))

    const resolved = await resolveApproval(opened.approval.approvalId, { option: 'apply', actor: web })
    expect(resolved.status).toBe('approved')
    expect(applyAction).toHaveBeenCalledTimes(1)
    const request = getDoctorRepairRequest(testDir, opened.request.id)!
    expect(request.status).toBe('verified')
    expect(request.events.map((e) => e.type)).toEqual(['created', 'task-created', 'approval-requested', 'applying', 'applied', 'verified'])
    expect(request.events.findIndex((e) => e.type === 'applying')).toBeLessThan(request.events.findIndex((e) => e.type === 'applied'))
    expect(tasks.get('task-1')).toMatchObject({ column: 'done' })
    expect(tasks.get('task-1')!.logs.at(-1)).toContain('verified')
    expect(getHealthReport().incidents.find((row) => row.id === opened.incident.id)).toBeUndefined()
  })

  it('refuses when the fresh plan differs: withdraws the approval (plan-changed), posts a fresh one, never mutates', async () => {
    const opened = await openRepair()
    planTarget = 'search-index-v2'

    const err = await resolveApproval(opened.approval.approvalId, { option: 'apply', actor: web }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApprovalResolveError)
    expect((err as ApprovalResolveError).status).toBe(409)
    expect(applyAction).not.toHaveBeenCalled()
    expect(getApprovalRecord(opened.approval.approvalId)).toMatchObject({ status: 'cancelled', response: { comment: 'plan-changed' } })

    const request = getDoctorRepairRequest(testDir, opened.request.id)!
    expect(request.status).toBe('sent')
    expect(request.approvalId).toBe(`health-repair:${request.id}:1`)
    expect(request.proposal?.items[0]?.changes[0]?.target).toBe('search-index-v2')
    const fresh = getApprovalRecord(request.approvalId!)!
    expect(fresh.status).toBe('pending')
    expect((fresh.owner as { proposal: { items: Array<{ changes: Array<{ target: string }> }> } }).proposal.items[0]!.changes[0]!.target).toBe('search-index-v2')
    expect(tasks.get('task-1')!.logs.at(-1)).toContain('changed since you were asked')
    expect(tasks.get('task-1')!.column).toBe('review')

    // The stale record is dead for good; the fresh one applies.
    await expect(resolveApproval(opened.approval.approvalId, { option: 'apply', actor: web })).rejects.toBeInstanceOf(ApprovalNotPendingError)
    await resolveApproval(request.approvalId!, { option: 'apply', actor: web })
    expect(applyAction).toHaveBeenCalledTimes(1)
    expect(getDoctorRepairRequest(testDir, opened.request.id)!.status).toBe('verified')
  })

  it('withdraws the approval when nothing is left to repair and leaves the task for auto-close', async () => {
    const opened = await openRepair()
    unhealthy = false
    await refresh('exec-2')

    const err = await resolveApproval(opened.approval.approvalId, { option: 'apply', actor: web }).catch((e: unknown) => e)
    expect((err as ApprovalResolveError).status).toBe(409)
    expect(applyAction).not.toHaveBeenCalled()
    expect(getApprovalRecord(opened.approval.approvalId)?.status).toBe('cancelled')
    expect(listApprovalRecords({ status: 'pending' })).toHaveLength(0)
    expect(getDoctorRepairRequest(testDir, opened.request.id)!.status).toBe('sent')
    expect(tasks.get('task-1')!.logs.at(-1)).toContain('nothing is left to repair')
  })

  it('a repair step that throws resolves the approval, marks the request failed and blocks the task with the reason', async () => {
    const opened = await openRepair()
    applyThrows = 'disk is read-only'
    const resolved = await resolveApproval(opened.approval.approvalId, { option: 'apply', actor: web })
    expect(resolved.status).toBe('approved')
    expect(getDoctorRepairRequest(testDir, opened.request.id)!.status).toBe('failed')
    // applyDoctorRepair folds an action's throw into a failed result; the kind reports it as a failed step.
    expect(tasks.get('task-1')).toMatchObject({ column: 'blocked', blockedReason: '1 repair step(s) failed: disk is read-only' })
  })

  it('a repair that runs but leaves the incident burning is failed + blocked, never verified', async () => {
    const opened = await openRepair()
    applyLeavesUnhealthy = true
    await resolveApproval(opened.approval.approvalId, { option: 'apply', actor: web })
    const request = getDoctorRepairRequest(testDir, opened.request.id)!
    expect(request.status).toBe('failed')
    expect(request.events.map((e) => e.type)).toContain('applied')
    expect(tasks.get('task-1')!.column).toBe('blocked')
    expect(tasks.get('task-1')!.blockedReason).toContain('did not evaluate healthy')
  })

  it('an absent incident is NOT a pass: a fresh check answering unknown after the repair marks it failed, never verified (R4)', async () => {
    const opened = await openRepair()
    postApplyMode = 'unknown'
    const resolved = await resolveApproval(opened.approval.approvalId, { option: 'apply', actor: web })
    expect(resolved.status).toBe('approved')
    // The original action_required incident is gone from the report (the check
    // now says unknown) — still not a verification.
    expect(getHealthReport().incidents.find((row) => row.id === opened.incident.id)).toBeUndefined()
    const request = getDoctorRepairRequest(testDir, opened.request.id)!
    expect(request.status).toBe('failed')
    expect(tasks.get('task-1')).toMatchObject({ column: 'blocked' })
    expect(tasks.get('task-1')!.blockedReason).toContain('did not evaluate healthy')
  })

  it('a fresh check that FAILS after the repair keeps the request failed, never verified (R4)', async () => {
    const opened = await openRepair()
    postApplyMode = 'throw'
    await resolveApproval(opened.approval.approvalId, { option: 'apply', actor: web })
    expect(getDoctorRepairRequest(testDir, opened.request.id)!.status).toBe('failed')
    expect(tasks.get('task-1')!.column).toBe('blocked')
  })

  it('pendingRepairApprovalFor finds the approval whose frozen proposal covers an observation', async () => {
    const opened = await openRepair()
    expect(pendingRepairApprovalFor(['approvals-test.search:index'])?.approvalId).toBe(opened.approval.approvalId)
    expect(pendingRepairApprovalFor(['approvals-test.auth:openai'])).toBeNull()
    await resolveApproval(opened.approval.approvalId, { option: 'dismiss', actor: web })
    expect(pendingRepairApprovalFor(['approvals-test.search:index'])).toBeNull()
  })

  it('simultaneous Health-card and Discord clicks: one applies, the other is refused, the action runs once', async () => {
    const opened = await openRepair()
    const outcomes = await Promise.allSettled([
      resolveApproval(opened.approval.approvalId, { option: 'apply', actor: web }),
      resolveApproval(opened.approval.approvalId, { option: 'apply', actor: channel }),
    ])
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    expect((outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(ApprovalNotPendingError)
    expect(applyAction).toHaveBeenCalledTimes(1)
  })

  it('ownerState: live while the request waits, orphaned once decided, superseded or deleted', async () => {
    const opened = await openRepair()
    const record = opened.approval as never
    expect(await healthRepairApprovalKind.ownerState(record)).toBe('live')
    updateDoctorRepairRequest(testDir, opened.request.id, (r) => ({ ...r, approvalId: 'health-repair:other' }))
    expect(await healthRepairApprovalKind.ownerState(record)).toBe('orphaned')
    updateDoctorRepairRequest(testDir, opened.request.id, (r) => ({ ...r, approvalId: opened.approval.approvalId, status: 'dismissed' }))
    expect(await healthRepairApprovalKind.ownerState(record)).toBe('orphaned')
    expect(await healthRepairApprovalKind.ownerState({ ...opened.approval, owner: { ...opened.approval.owner, requestId: 'repair-missing' } } as never)).toBe('orphaned')
  })
})

describe('dismiss', () => {
  it('snoozes action_required incidents for 7 days, completes the task and marks the request dismissed', async () => {
    const opened = await openRepair()
    const resolved = await resolveApproval(opened.approval.approvalId, { option: 'dismiss', comment: 'known, waiting on vendor', actor: web })
    expect(resolved.status).toBe('rejected')
    const ack = readAckRecords()[opened.incident.id]!
    expect(ack.mode).toBe('snooze')
    expect(Date.parse(ack.until!) - Date.parse(ack.at)).toBe(7 * 24 * 60 * 60 * 1000)
    expect(getDoctorRepairRequest(testDir, opened.request.id)!.status).toBe('dismissed')
    expect(tasks.get('task-1')).toMatchObject({ column: 'done' })
    expect(tasks.get('task-1')!.logs.at(-1)).toContain('known, waiting on vendor')
    expect(applyAction).not.toHaveBeenCalled()
  })

  it('navigate approvals accept Dismiss and nothing else', async () => {
    const report = getHealthReport()
    const incident = report.incidents.find((row) => row.id.includes('expired'))!
    const opened = await openNavigateApproval({ contentDir: testDir, report, incident })
    const err = await resolveApproval(opened.approval.approvalId, { option: 'apply', actor: web }).catch((e: unknown) => e)
    expect((err as ApprovalResolveError).status).toBe(400)
    expect(getApprovalRecord(opened.approval.approvalId)?.status).toBe('pending')
    await resolveApproval(opened.approval.approvalId, { option: 'dismiss', actor: channel })
    expect(readAckRecords()[incident.id]?.mode).toBe('snooze')
    expect(tasks.get('task-1')!.column).toBe('done')
  })
})

describe('recoverInterruptedApplies', () => {
  it('an unregistered originating check never verifies an interrupted apply (R4)', async () => {
    const opened = await openRepair()
    updateDoctorRepairRequest(testDir, opened.request.id, (r) => ({ ...r, status: 'applying' }))
    unregisterPluginHealthChecks('approvals-test')
    // The incident is absent now (no check) — still failed + blocked, never verified.
    const summary = await recoverInterruptedApplies(testDir)
    expect(summary).toEqual({ recovered: 1, verified: 0, failed: 1 })
    expect(getDoctorRepairRequest(testDir, opened.request.id)!.status).toBe('failed')
    expect(tasks.get(opened.taskId)!.blockedReason).toContain('did not evaluate healthy')
    expect(getApprovalRecord(opened.approval.approvalId)?.status).toBe('cancelled')
  })

  it('verifies a request stuck in applying: clean checks → verified + done; still burning → failed + blocked; the approval is withdrawn', async () => {
    const clean = await openRepair()
    updateDoctorRepairRequest(testDir, clean.request.id, (r) => ({ ...r, status: 'applying' }))
    unhealthy = false
    const burning = await openNavigateApproval({ contentDir: testDir, report: getHealthReport(), incident: getHealthReport().incidents.find((row) => row.id.includes('expired'))! })
    updateDoctorRepairRequest(testDir, burning.request.id, (r) => ({ ...r, status: 'applying' }))

    const summary = await recoverInterruptedApplies(testDir)
    expect(summary).toEqual({ recovered: 2, verified: 1, failed: 1 })
    expect(getDoctorRepairRequest(testDir, clean.request.id)!.status).toBe('verified')
    expect(tasks.get(clean.taskId)!.column).toBe('done')
    expect(getApprovalRecord(clean.approval.approvalId)?.status).toBe('cancelled')
    expect(getDoctorRepairRequest(testDir, burning.request.id)!.status).toBe('failed')
    expect(tasks.get(burning.taskId)).toMatchObject({ column: 'blocked' })
    expect(tasks.get(burning.taskId)!.blockedReason).toContain('interrupted by a restart')
    expect(getApprovalRecord(burning.approval.approvalId)?.status).toBe('cancelled')
  })
})
