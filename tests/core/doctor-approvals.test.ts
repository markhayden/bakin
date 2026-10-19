/**
 * Health approval kinds (plan PR 2 T7): opening a repair/navigate approval
 * (review task, request, record), Apply with the frozen-proposal guard (R1:
 * delayed approval, plan changed, nothing left), Dismiss (snooze/ack + task
 * done), simultaneous decisions, apply failure, and recovery of a request
 * interrupted mid-apply. Real report cache, real repair action, real stores.
 */
import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime } from 'bun:test'
import { UI_OPERATOR, discordUser } from '../helpers/approval-provenance'
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
// A channel surface for the outcome follow-up; absent unless a test sets it.
const postApprovalOutcomeOnChannel = mock(async (_args: unknown) => {})
let channelRuntime: { runtime: { channels: Record<string, unknown> } } | undefined
mock.module('../../src/core/app-services-store', () => ({ maybeGetAppServices: () => channelRuntime, getAppServices: () => { throw new Error('no services') } }))

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
import { reannounceApproval, resolveApproval, settleApprovalFollowUps } from '../../src/core/approvals/service'
import { _resetOperationRegistryForTests } from '../../src/core/operations'
import { ApprovalNotPendingError, ApprovalResolveError } from '../../src/core/approvals/errors'
import { applyHealthCheckRun, getHealthReport, resetHealthReportCache } from '../../src/core/doctor-report-cache'
import { runHealthCheck } from '../../src/core/doctor-checks'
import { clearStoredRepairPlans, PLAN_TTL_MS } from '../../src/core/doctor-repair-plans'
import { planDoctorRepair } from '../../src/core/doctor-repair'
import { createDoctorRepairRequest, getDoctorRepairRequest, updateDoctorRepairRequest } from '../../src/core/doctor-repair-store'
import { readAckRecords } from '../../src/core/health-acks'
import {
  getHealthCheck,
  registerPluginHealthCheck,
  registerPluginHealthRepairAction,
  unregisterHealthCheck,
  unregisterPluginHealthChecks,
} from '../../src/core/health-check-registry'
import {
  attachResurfaceApproval,
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
let applyGate: Promise<void> | null = null
let applyLeavesUnhealthy = false
/** The action's planner re-runs Health while planning, so its fresh plan is stale before it can be claimed. */
let planRefreshesHealth = false
/** After apply the search check answers this way instead of healthy (R4 probes). */
let postApplyMode: 'unknown' | 'throw' | null = null
const applyAction = mock(async (items: HealthRepairPlanItem[]) => {
  if (applyGate) await applyGate
  if (applyThrows) throw new Error(applyThrows)
  if (!applyLeavesUnhealthy) unhealthy = false
  return items.map((item) => ({ itemId: item.id, actionId: item.actionId, status: 'applied' as const, message: 'Rebuilt the search index.', affectedCheckIds: ['approvals-test.search'], changes: item.changes }))
})
const web = UI_OPERATOR
const channel = discordUser('u-1', 'Owner')

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
    operationPlan: () => ({ stages: [{ id: 'apply', kind: 'installing' as const, label: 'Apply' }], pointOfNoReturn: 'apply' }),
    plan: async () => {
      if (planRefreshesHealth) await refresh()
      return [{
      id: 'rebuild', actionId: 'rebuild-index', title: 'Rebuild search index', reason: 'The index is corrupt.', safety: 'destructive',
      incidentIds: [], observationIds: [], preconditions: [],
      changes: [{ kind: 'file', target: planTarget, action: 'delete', description: 'Drop and rebuild the search index.' }],
    }]
    },
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
  applyGate = null
  applyLeavesUnhealthy = false
  planRefreshesHealth = false
  channelRuntime = undefined
  postApprovalOutcomeOnChannel.mockClear()
  postApplyMode = null
  applyAction.mockClear()
  createTaskWithEffects.mockClear()
  await seed()
})

afterEach(() => {
  _resetOperationRegistryForTests()
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

    const resolved = await resolveApproval(opened.approval.approvalId, { option: 'apply', provenance: web })

    await settleApprovalFollowUps()
    expect(resolved.status).toBe('approved')
    expect(applyAction).toHaveBeenCalledTimes(1)
    const request = getDoctorRepairRequest(testDir, opened.request.id)!
    expect(request.status).toBe('verified')
    expect(request.events.map((e) => e.type)).toEqual(['created', 'task-created', 'approval-requested', 'applying', 'operation-started', 'applied', 'verified'])
    expect(request.events.findIndex((e) => e.type === 'applying')).toBeLessThan(request.events.findIndex((e) => e.type === 'applied'))
    expect(tasks.get('task-1')).toMatchObject({ column: 'done' })
    expect(tasks.get('task-1')!.logs.at(-1)).toContain('verified')
    expect(getHealthReport().incidents.find((row) => row.id === opened.incident.id)).toBeUndefined()
  })

  it('refuses when the fresh plan differs: withdraws the approval (plan-changed), posts a fresh one, never mutates', async () => {
    const opened = await openRepair()
    planTarget = 'search-index-v2'

    const err = await resolveApproval(opened.approval.approvalId, { option: 'apply', provenance: web }).catch((e: unknown) => e)
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
    await expect(resolveApproval(opened.approval.approvalId, { option: 'apply', provenance: web })).rejects.toBeInstanceOf(ApprovalNotPendingError)
    await resolveApproval(request.approvalId!, { option: 'apply', provenance: web })
    await settleApprovalFollowUps()
    expect(applyAction).toHaveBeenCalledTimes(1)
    expect(getDoctorRepairRequest(testDir, opened.request.id)!.status).toBe('verified')
  })

  it('withdraws the approval when nothing is left to repair and leaves the task for auto-close', async () => {
    const opened = await openRepair()
    unhealthy = false
    await refresh('exec-2')

    const err = await resolveApproval(opened.approval.approvalId, { option: 'apply', provenance: web }).catch((e: unknown) => e)
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
    const resolved = await resolveApproval(opened.approval.approvalId, { option: 'apply', provenance: web })
    await settleApprovalFollowUps()
    expect(resolved.status).toBe('approved')
    expect(getDoctorRepairRequest(testDir, opened.request.id)!.status).toBe('failed')
    // applyDoctorRepair folds an action's throw into a failed result; the kind reports it as a failed step.
    expect(tasks.get('task-1')).toMatchObject({ column: 'blocked', blockedReason: '1 repair step(s) failed: disk is read-only' })
  })

  it('a repair that cannot start still follows the decision with exactly one failure outcome on the channel card', async () => {
    const opened = await openRepair()
    channelRuntime = { runtime: { channels: { resolveApproval: mock(async () => {}), postApprovalOutcome: postApprovalOutcomeOnChannel } } }
    const record = { ...getApprovalRecord(opened.approval.approvalId)!, deliveries: [{ channelId: 'general', ref: 'card-1', renderedAt: '2026-10-16T00:00:00.000Z' }] }
    planRefreshesHealth = true
    const result = await healthRepairApprovalKind.onResolve(record as never, { option: 'apply', provenance: web })
    // Asserted on a copy: bun's toMatchObject writes asymmetric matchers into the received object.
    const startFailure = (result as { startFailure?: unknown }).startFailure
    expect(typeof startFailure).toBe('string')
    expect(String(startFailure)).toContain('Repair could not start')
    expect(postApprovalOutcomeOnChannel).not.toHaveBeenCalled()
    await healthRepairApprovalKind.afterResolve!(record as never, result)
    expect(postApprovalOutcomeOnChannel).toHaveBeenCalledTimes(1)
    expect(postApprovalOutcomeOnChannel.mock.calls[0]![0]).toMatchObject({ approvalId: record.approvalId, outcome: { status: 'failed', title: 'Repair did not run', message: expect.stringContaining('Repair could not start') } })
    expect(getDoctorRepairRequest(testDir, opened.request.id)!.status).toBe('failed')
    expect(applyAction).not.toHaveBeenCalled()
  })

  it('a repair that runs but leaves the incident burning is failed + blocked, never verified', async () => {
    const opened = await openRepair()
    applyLeavesUnhealthy = true
    await resolveApproval(opened.approval.approvalId, { option: 'apply', provenance: web })
    await settleApprovalFollowUps()
    const request = getDoctorRepairRequest(testDir, opened.request.id)!
    expect(request.status).toBe('failed')
    expect(request.events.map((e) => e.type)).toContain('applied')
    expect(tasks.get('task-1')!.column).toBe('blocked')
    expect(tasks.get('task-1')!.blockedReason).toContain('did not evaluate healthy')
  })

  it('an absent incident is NOT a pass: a fresh check answering unknown after the repair marks it failed, never verified (R4)', async () => {
    const opened = await openRepair()
    postApplyMode = 'unknown'
    const resolved = await resolveApproval(opened.approval.approvalId, { option: 'apply', provenance: web })
    await settleApprovalFollowUps()
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
    await resolveApproval(opened.approval.approvalId, { option: 'apply', provenance: web })
    await settleApprovalFollowUps()
    expect(getDoctorRepairRequest(testDir, opened.request.id)!.status).toBe('failed')
    expect(tasks.get('task-1')!.column).toBe('blocked')
  })

  it('pendingRepairApprovalFor finds the approval whose frozen proposal covers an observation', async () => {
    const opened = await openRepair()
    expect(pendingRepairApprovalFor(['approvals-test.search:index'])?.approvalId).toBe(opened.approval.approvalId)
    expect(pendingRepairApprovalFor(['approvals-test.auth:openai'])).toBeNull()
    await resolveApproval(opened.approval.approvalId, { option: 'dismiss', provenance: web })
    expect(pendingRepairApprovalFor(['approvals-test.search:index'])).toBeNull()
  })

  it('simultaneous Health-card and Discord clicks: one applies, the other is refused, the action runs once', async () => {
    const opened = await openRepair()
    const outcomes = await Promise.allSettled([
      resolveApproval(opened.approval.approvalId, { option: 'apply', provenance: web }),
      resolveApproval(opened.approval.approvalId, { option: 'apply', provenance: channel }),
    ])
    await settleApprovalFollowUps()
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    expect((outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(ApprovalNotPendingError)
    expect(applyAction).toHaveBeenCalledTimes(1)
  })

  it('decision first, outcome after (D24): the approval resolves while the repair still runs', async () => {
    const opened = await openRepair()
    let release!: () => void
    applyGate = new Promise<void>((resolve) => { release = resolve })
    const resolved = await resolveApproval(opened.approval.approvalId, { option: 'apply', provenance: channel })
    // Saved and published before the repair has done anything.
    expect(resolved.status).toBe('approved')
    expect(broadcasts.some((b) => b.event === 'approval.resolved' && b.approvalId === opened.approval.approvalId)).toBe(true)
    const midFlight = getDoctorRepairRequest(testDir, opened.request.id)!
    expect(midFlight.status).toBe('applying')
    const started = midFlight.events.find((e) => e.type === 'operation-started')!
    expect(typeof (started.data as { operationId: string }).operationId).toBe('string')
    release()
    await settleApprovalFollowUps()
    expect(getDoctorRepairRequest(testDir, opened.request.id)!.status).toBe('verified')
    expect(tasks.get('task-1')).toMatchObject({ column: 'done' })
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
    const resolved = await resolveApproval(opened.approval.approvalId, { option: 'dismiss', comment: 'known, waiting on vendor', provenance: web })
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
    const err = await resolveApproval(opened.approval.approvalId, { option: 'apply', provenance: web }).catch((e: unknown) => e)
    expect((err as ApprovalResolveError).status).toBe(400)
    expect(getApprovalRecord(opened.approval.approvalId)?.status).toBe('pending')
    await resolveApproval(opened.approval.approvalId, { option: 'dismiss', provenance: channel })
    expect(readAckRecords()[incident.id]?.mode).toBe('snooze')
    expect(tasks.get('task-1')!.column).toBe('done')
  })
})

describe('resurfacing (spec D-G3)', () => {
  it('a delegated request the agent marked completed gets a navigate approval on its EXISTING task, dismissable like any navigate incident', async () => {
    const incident = getHealthReport().incidents.find((row) => row.id.includes('expired'))!
    tasks.set('task-delegated', { column: 'review', logs: [] })
    const created = createDoctorRepairRequest(testDir, { kind: 'delegate', incidentIds: [incident.id], observationIds: [...incident.observationIds] })
    const request = updateDoctorRepairRequest(testDir, created.id, (r) => ({ ...r, taskId: 'task-delegated', status: 'completed' }))
    const pendingBefore = broadcasts.filter((b) => b.event === 'approval.pending').length

    const approval = attachResurfaceApproval({ contentDir: testDir, request, incidents: [incident] })
    expect(approval.owner).toMatchObject({ kind: 'health-navigate', taskId: 'task-delegated', requestId: request.id, incidentIds: [incident.id] })
    expect(getDoctorRepairRequest(testDir, request.id)).toMatchObject({ status: 'sent', approvalId: approval.approvalId, kind: 'delegate' })
    expect(createTaskWithEffects).not.toHaveBeenCalled()
    expect(broadcasts.filter((b) => b.event === 'approval.pending')).toHaveLength(pendingBefore + 1)

    await resolveApproval(approval.approvalId, { option: 'dismiss', provenance: web })
    expect(readAckRecords()[incident.id]?.mode).toBe('snooze')
    expect(getDoctorRepairRequest(testDir, request.id)!.status).toBe('dismissed')
  })

  it('attaching never writes over a non-terminal status (a planned/sent request keeps it)', async () => {
    const incident = getHealthReport().incidents.find((row) => row.id.includes('expired'))!
    tasks.set('task-planned', { column: 'inProgress', logs: [] })
    const created = createDoctorRepairRequest(testDir, { kind: 'delegate', incidentIds: [incident.id], observationIds: [...incident.observationIds] })
    const request = updateDoctorRepairRequest(testDir, created.id, (r) => ({ ...r, taskId: 'task-planned', status: 'planned' }))
    const approval = attachResurfaceApproval({ contentDir: testDir, request, incidents: [incident] })
    expect(getDoctorRepairRequest(testDir, request.id)).toMatchObject({ status: 'planned', approvalId: approval.approvalId })
  })

  it('the report links each incident to its open repair task, never a verified or dismissed one (spec D-G2)', async () => {
    const opened = await openRepair()
    const linked = getHealthReport().incidents.find((row) => row.id === opened.incident.id)!
    expect(linked.repairTaskId).toBe('task-1')
    // The link is not a resource: resources feed the ack re-fire fingerprint.
    expect(linked.resources.some((resource) => resource.kind === 'task')).toBe(false)
    // The strict wire schema accepts it (a lagging mirror rejects the whole report).
    const { healthReportSchema } = await import('../../plugins/health/lib/route-schemas')
    expect(healthReportSchema.safeParse(getHealthReport()).success).toBe(true)

    updateDoctorRepairRequest(testDir, opened.request.id, (r) => ({ ...r, status: 'verified' }))
    expect(getHealthReport().incidents.find((row) => row.id === opened.incident.id)!.repairTaskId).toBeUndefined()
  })

  it('reannounceApproval re-publishes a pending approval once per call and refuses a decided one', async () => {
    const opened = await openRepair()
    const count = () => broadcasts.filter((b) => b.event === 'approval.pending' && b.approvalId === opened.approval.approvalId).length
    expect(count()).toBe(1)
    expect(reannounceApproval(opened.approval.approvalId)).toBe(true)
    expect(count()).toBe(2)
    await resolveApproval(opened.approval.approvalId, { option: 'dismiss', provenance: web })
    expect(reannounceApproval(opened.approval.approvalId)).toBe(false)
    expect(count()).toBe(2)
  })
})

describe('recoverInterruptedApplies', () => {
  it('old-reader recovery over records the new flow writes: a mid-flight apply whose operation is gone is outcome unknown, re-checked; terminal records are untouched', async () => {
    const opened = await openRepair()
    let release!: () => void
    applyGate = new Promise<void>((resolve) => { release = resolve })
    await resolveApproval(opened.approval.approvalId, { option: 'apply', provenance: web })
    // A restart: the in-memory operation is gone, the durable request says applying.
    _resetOperationRegistryForTests()
    unhealthy = false
    const summary = await recoverInterruptedApplies(testDir)
    expect(summary).toEqual({ recovered: 1, verified: 1, failed: 0 })
    const request = getDoctorRepairRequest(testDir, opened.request.id)!
    expect(request.status).toBe('verified')
    expect(tasks.get(opened.taskId)!.logs.some((line: string) => line.includes('the outcome is unknown'))).toBe(true)
    release()

    // A finished request (verified) is never re-recovered.
    expect(await recoverInterruptedApplies(testDir)).toEqual({ recovered: 0, verified: 0, failed: 0 })
  })

  it('a request whose repair operation is still live is left alone', async () => {
    const opened = await openRepair()
    let release!: () => void
    applyGate = new Promise<void>((resolve) => { release = resolve })
    await resolveApproval(opened.approval.approvalId, { option: 'apply', provenance: web })
    expect(await recoverInterruptedApplies(testDir)).toEqual({ recovered: 0, verified: 0, failed: 0 })
    release()
    await settleApprovalFollowUps()
    expect(getDoctorRepairRequest(testDir, opened.request.id)!.status).toBe('verified')
  })

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
