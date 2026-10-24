import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { healthError, healthHealthy, healthObserved } from '@makinbakin/sdk/utils'

const testDir = join(tmpdir(), `bakin-test-doctor-repair-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, home: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
afterAll(() => { closeDb(); rmSync(testDir, { recursive: true, force: true }) })

const appendAudit = mock()
mock.module('../../src/core/audit', () => ({ appendAudit }))
mock.module('../../src/core/settings', () => ({
  getSettings: () => ({ doctor: { intervalMs: 60_000, requireOnboard: false, escalation: false, escalationCooldownMs: 60_000, sensitivity: 'standard' } }),
}))
mock.module('../../src/core/onboarding/state', () => ({ isOnboarded: () => true }))
const liveTasks = new Set<string>()
const taskColumns = new Map<string, string>()
// Admission reads the task store synchronously (no yield between the durable
// check and the reservation); only that one read is faked, the rest is real.
import * as realTaskStore from '../../src/core/task-store'
// Captured BEFORE the module is mocked: the namespace import is a live binding
// and would otherwise resolve to the mock itself (infinite recursion).
const realGetTaskWithColumn = realTaskStore.getTaskWithColumn
mock.module('../../src/core/task-store', () => ({
  ...realTaskStore,
  getTaskWithColumn: (id: string) => (liveTasks.has(id) ? { task: { id }, column: taskColumns.get(id) ?? 'todo' } : realGetTaskWithColumn(id)),
}))

mock.module('../../src/core/logger', () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) }))

import { applyHealthCheckRun, getHealthReport, resetHealthReportCache } from '../../src/core/doctor-report-cache'
import { runHealthCheck } from '../../src/core/doctor-checks'
import { awaitDoctorRepair, planDoctorRepair, startDoctorRepair, type DoctorRepairApplyOptions } from '../../src/core/doctor-repair'
import { clearStoredRepairPlans } from '../../src/core/doctor-repair-plans'
import { createDoctorRepairRequest, updateDoctorRepairRequest } from '../../src/core/doctor-repair-store'
import { incidentHolder, resetIncidentReservationsForTests } from '../../src/core/doctor-reservations'
import { _resetOperationRegistryForTests, getOperationRegistry } from '../../src/core/operations'
import { OperationRejectedError } from '@bakin/core/operations'
import { blockTask, createTask, escalateTaskToReview, moveTask } from '../../src/core/task-store'
import { closeDb } from '../../packages/core/src/storage/db'
import { healthRepairApplyReportSchema } from '../../plugins/health/lib/route-schemas'

/** Start the repair operation and wait for its report, as every in-process caller does. */
async function applyDoctorRepair(options: DoctorRepairApplyOptions) {
  const started = await startDoctorRepair({ ...options, origin: 'web' })
  const { report } = await awaitDoctorRepair(started.operationId)
  if (!report) throw new Error('the repair produced no report')
  return report
}
import {
  getHealthCheck,
  registerPluginHealthCheck,
  registerPluginHealthRepairAction,
  unregisterHealthCheck,
  unregisterHealthRepairAction,
  unregisterPluginHealthChecks,
} from '../../src/core/health-check-registry'

const NONE = { deletesUserContent: false, spendsMoney: false, widensAuthorization: false }
const DEL = { deletesUserContent: true, spendsMoney: false, widensAuthorization: false }

let unhealthy = true
let applyBarrier: Promise<void> | null = null
let planResultOverride: unknown
let applyResultOverride: unknown
const applyAction = mock(async (items: any[]) => {
  if (applyBarrier) await applyBarrier
  unhealthy = false
  if (applyResultOverride !== undefined) return applyResultOverride as any
  return items.map((item) => ({
    itemId: item.id,
    actionId: item.actionId,
    status: 'applied' as const,
    message: 'Restarted Search.',
    affectedCheckIds: ['repair-test.search'],
    changes: item.changes,
  }))
})

async function seed() {
  registerPluginHealthRepairAction('repair-test', {
    id: 'restart-search',
    name: 'Restart Search',
    effects: NONE, mutation: 'none',
    operationPlan: () => ({ stages: [{ id: 'apply', kind: 'installing' as const, label: 'Apply' }], pointOfNoReturn: 'apply' }),
    plan: async () => planResultOverride !== undefined
      ? planResultOverride as any
      : [{
          id: 'restart', actionId: 'restart-search', title: 'Restart Search', reason: 'Search is unavailable.',
          incidentIds: [], observationIds: [], preconditions: [],
          changes: [{ kind: 'service', target: 'search', action: 'invoke', description: 'Restart Search.' }],
        }],
    apply: applyAction,
  })
  const id = registerPluginHealthCheck('repair-test', {
    id: 'search', name: 'Search readiness', description: 'Checks Search availability.', group: { key: 'search', label: 'Search' },
    incidents: [{ id: 'unavailable', subjectKind: 'service', resolution: { type: 'repair', actionId: 'restart-search' }, required: 'always' }],
    run: async () => healthObserved(unhealthy ? [healthError({
      key: 'engine', summary: 'Search is unavailable.',
      incident: {
        key: 'unavailable', title: 'Search is unavailable', impact: 'Search requests fail.', disposition: 'action_required',
        subject: { kind: 'service', id: 'search-engine' }, declarationId: 'unavailable',
        resolution: { key: 'restart', type: 'repair', label: 'Review restart', actionId: 'restart-search' },
      },
    })] : [healthHealthy({ key: 'engine', summary: 'Search is ready.' })]),
  }, 'Repair Test')
  const run = await runHealthCheck(getHealthCheck(id)!, { executionId: () => 'execution-1' })
  applyHealthCheckRun(run)
}

beforeEach(async () => {
  resetHealthReportCache()
  clearStoredRepairPlans()
  unhealthy = true
  applyBarrier = null
  planResultOverride = undefined
  applyResultOverride = undefined
  applyAction.mockClear()
  appendAudit.mockClear()
  await seed()
})

afterEach(() => {
  _resetOperationRegistryForTests()
  unregisterPluginHealthChecks('repair-test')
  unregisterHealthCheck('core.onboarded')
})

describe('targeted canonical doctor repair', () => {
  it('stamps owner action ids and immutable evidence preconditions', async () => {
    const report = getHealthReport()
    const plan = await planDoctorRepair({
      contentDir: '/tmp/content', projectRoot: '/tmp/project',
      target: { type: 'incidents', reportId: report.id, ids: [report.incidents[0].id] },
    })
    expect(plan.items[0]).toMatchObject({
      id: 'repair-test.restart-search:restart',
      localId: 'restart', // the planner's own handle; `id` is core's opaque canonical id
      actionId: 'repair-test.restart-search',
      observationIds: ['repair-test.search:engine'],
      preconditions: [{ observationId: 'repair-test.search:engine', executionId: 'execution-1', status: 'error', resolutionKey: 'restart' }],
    })
  })

  it('rejects malformed plan output without retaining its payload', async () => {
    const secret = 'plan-output-must-not-leak'
    planResultOverride = [{
      id: 'restart', localId: 'restart', actionId: 'restart-search', title: 'Restart Search', reason: 'Search is unavailable.',
      incidentIds: [], observationIds: [], preconditions: [], changes: [], secret,
    }]
    const report = getHealthReport()

    let rejected: unknown
    try {
      await planDoctorRepair({
        contentDir: '/tmp/content', projectRoot: '/tmp/project',
        target: { type: 'all_actionable', reportId: report.id },
      })
    } catch (error) {
      rejected = error
    }

    expect(rejected).toMatchObject({ code: 'INVALID_HEALTH_REPAIR_PLAN_OUTPUT' })
    expect(JSON.stringify(rejected)).not.toContain(secret)
  })

  it('applies then targeted-verifies without equating mutation with health', async () => {
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    const result = await applyDoctorRepair({
      contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId,
      itemIds: [plan.items[0].id], confirmedItemIds: [],
    })
    expect(result.results[0].status).toBe('applied')
    expect(result.verifiedReportId).toBe(result.report.id)
    expect(result.report.observations.find((row) => row.checkId === 'repair-test.search')?.status).toBe('healthy')
    expect(result.remainingIncidentIds).toEqual([])
  })

  it('turns malformed apply output into a payload-free failure and still verifies the mutation', async () => {
    const report = getHealthReport()
    const plan = await planDoctorRepair({
      contentDir: '/tmp/content', projectRoot: '/tmp/project',
      target: { type: 'all_actionable', reportId: report.id },
    })
    const secret = 'apply-output-must-not-leak'
    applyResultOverride = [{
      itemId: 'invented-item',
      actionId: plan.items[0].actionId,
      status: 'applied',
      message: secret,
      affectedCheckIds: ['repair-test.search'],
      changes: [],
    }]

    const result = await applyDoctorRepair({
      contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId,
      itemIds: [plan.items[0].id], confirmedItemIds: [],
    })

    expect(result.results).toEqual([expect.objectContaining({
      status: 'failed',
      message: 'Health repair apply output failed contract validation.',
    })])
    expect(JSON.stringify(result.results)).not.toContain(secret)
    expect(result.report.observations.find((row) => row.checkId === 'repair-test.search')?.status).toBe('healthy')
  })

  it('rejects changed target evidence with zero action calls', async () => {
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    unhealthy = false
    applyHealthCheckRun(await runHealthCheck(getHealthCheck('repair-test.search')!, { executionId: () => 'execution-2' }))
    const refusal = await applyDoctorRepair({
      contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId,
      itemIds: [plan.items[0].id], confirmedItemIds: [],
    }).catch((err: unknown) => err)
    // Validation keeps today's 409 body and never registers an operation.
    expect(refusal).toBeInstanceOf(OperationRejectedError)
    expect(refusal).toMatchObject({ httpStatus: 409, body: { code: 'STALE_PLAN' } })
    expect(applyAction).not.toHaveBeenCalled()
    expect(getOperationRegistry().list()).toEqual([])
  })

  it('two applies of the same selection attach to one run; the plan is consumed once', async () => {
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    let releaseApply!: () => void
    applyBarrier = new Promise<void>((resolve) => { releaseApply = resolve })
    const options = { contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId, itemIds: [plan.items[0].id], confirmedItemIds: [], origin: 'web' as const }

    const first = await startDoctorRepair(options)
    const second = await startDoctorRepair(options)
    expect(second).toEqual({ operationId: first.operationId, bootId: first.bootId, attached: true })
    releaseApply()
    const { report: applied } = await awaitDoctorRepair(first.operationId)
    expect(applied?.results[0]?.status).toBe('applied')
    expect(applyAction).toHaveBeenCalledTimes(1)

    // A later identical apply is a new request against a consumed plan: stale.
    const late = await startDoctorRepair(options).catch((err: unknown) => err)
    expect(late).toMatchObject({ httpStatus: 409, body: { code: 'STALE_PLAN' } })
  })

  it('refuses a DIFFERENT plan over an incident a running repair holds — 409 repair_in_flight — and frees it at settle (#896)', async () => {
    const report = getHealthReport()
    const first = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    const second = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    expect(second.planId).not.toBe(first.planId)
    expect(first.items[0].incidentIds.length).toBeGreaterThan(0)
    let releaseApply!: () => void
    applyBarrier = new Promise<void>((resolve) => { releaseApply = resolve })

    const started = await startDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: first.planId, itemIds: [first.items[0].id], confirmedItemIds: [], origin: 'web' })
    const refusal = await startDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: second.planId, itemIds: [second.items[0].id], confirmedItemIds: [], origin: 'web' })
      .catch((err: unknown) => err)
    expect(refusal).toBeInstanceOf(OperationRejectedError)
    expect(refusal).toMatchObject({ httpStatus: 409, body: { code: 'repair_in_flight', overlapping: first.items[0].incidentIds } })
    // Nothing started for the refused plan, and its plan is NOT consumed.
    expect(getOperationRegistry().list().filter((view) => view.kind === 'repair')).toHaveLength(1)
    expect(applyAction).toHaveBeenCalledTimes(1)

    releaseApply()
    await awaitDoctorRepair(started.operationId)
    // The reservation died with the operation: the second plan may run now (its
    // target evidence changed because the first repair healed it → STALE_PLAN,
    // which is validation, not admission).
    const late = await startDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: second.planId, itemIds: [second.items[0].id], confirmedItemIds: [], origin: 'web' })
      .catch((err: unknown) => err)
    expect(late).toMatchObject({ httpStatus: 409, body: { code: 'STALE_PLAN' } })
  })

  it('refuses an apply over an incident an OPEN delegated task is working — unless the caller is that task\'s agent (#896 review)', async () => {
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: testDir, projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    const incidentId = plan.items[0].incidentIds[0]!
    const request = createDoctorRepairRequest(testDir, { kind: 'delegate', incidentIds: [incidentId], observationIds: plan.items[0].observationIds })
    updateDoctorRepairRequest(testDir, request.id, (r) => ({ ...r, status: 'sent', taskId: 'task-live', agentId: 'main' }))
    liveTasks.add('task-live')
    try {
      const options = { contentDir: testDir, projectRoot: '/tmp/project', planId: plan.planId, itemIds: [plan.items[0].id], confirmedItemIds: [], origin: 'web' as const }
      const refusal = await startDoctorRepair(options).catch((err: unknown) => err)
      expect(refusal).toMatchObject({ httpStatus: 409, body: { code: 'repair_in_flight', overlapping: [incidentId], heldBy: 'task:task-live' } })
      expect(getOperationRegistry().list()).toEqual([])
      expect(incidentHolder(incidentId)).toBeUndefined()
      // The owning agent applying from inside its task is the hand-off.
      const started = await startDoctorRepair({ ...options, actingAgentId: 'main' })
      await awaitDoctorRepair(started.operationId)
      expect(applyAction).toHaveBeenCalledTimes(1)
    } finally {
      liveTasks.delete('task-live')
    }
  })

  it('a delegated task handed back to the operator (resurfaced to Review) no longer blocks the operator\'s apply (#896 review r5)', async () => {
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: testDir, projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    const incidentId = plan.items[0].incidentIds[0]!
    const request = createDoctorRepairRequest(testDir, { kind: 'delegate', incidentIds: [incidentId], observationIds: plan.items[0].observationIds })
    // Resurfacing keeps kind `delegate` + status `sent` and appends the window mark; the task moves to Review.
    updateDoctorRepairRequest(testDir, request.id, (r) => ({ ...r, status: 'sent', taskId: 'task-handed', agentId: 'main', events: [...r.events, { ts: new Date().toISOString(), type: 'resurfaced', message: 'handed back' }] }))
    liveTasks.add('task-handed')
    const options = { contentDir: testDir, projectRoot: '/tmp/project', planId: plan.planId, itemIds: [plan.items[0].id], confirmedItemIds: [], origin: 'web' as const }
    try {
      for (const column of ['inProgress', 'blocked']) {
        taskColumns.set('task-handed', column)
        const refusal = await startDoctorRepair(options).catch((err: unknown) => err)
        expect(refusal).toMatchObject({ httpStatus: 409, body: { code: 'repair_in_flight', heldBy: 'task:task-handed' } })
      }
      taskColumns.set('task-handed', 'review')
      const started = await startDoctorRepair(options)
      await awaitDoctorRepair(started.operationId)
      expect(applyAction).toHaveBeenCalledTimes(1)
    } finally {
      liveTasks.delete('task-handed')
      taskColumns.delete('task-handed')
    }
  })

  it('the real sequence: a delegated task the agent BLOCKED is refused until Health hands it back to Review, then the operator applies (#896 review r6)', async () => {
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: testDir, projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    const incidentId = plan.items[0].incidentIds[0]!
    const task = await createTask('Health: restart Search', 'todo', 'main')
    await moveTask(task.id, 'inProgress')
    await blockTask(task.id, 'installer hung at 40%')
    const request = createDoctorRepairRequest(testDir, { kind: 'delegate', incidentIds: [incidentId], observationIds: plan.items[0].observationIds })
    updateDoctorRepairRequest(testDir, request.id, (r) => ({ ...r, status: 'sent', taskId: task.id, agentId: 'main' }))
    const options = { contentDir: testDir, projectRoot: '/tmp/project', planId: plan.planId, itemIds: [plan.items[0].id], confirmedItemIds: [], origin: 'web' as const }
    const refusal = await startDoctorRepair(options).catch((err: unknown) => err)
    expect(refusal).toMatchObject({ httpStatus: 409, body: { code: 'repair_in_flight', heldBy: `task:${task.id}` } })
    // Escalation's resurface: the ONE move Health makes, blocked reason on the log line.
    expect(escalateTaskToReview(task.id, 'Health: not fixed after 12h — handed back to you.')).toBe('blocked')
    const started = await startDoctorRepair(options)
    await awaitDoctorRepair(started.operationId)
    expect(applyAction).toHaveBeenCalledTimes(1)
  })

  it('hands the reservation back to releaseTo at settle instead of freeing it (#896 review)', async () => {
    resetIncidentReservationsForTests()
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    const incidentId = plan.items[0].incidentIds[0]!
    const started = await startDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId, itemIds: [plan.items[0].id], confirmedItemIds: [], origin: 'system', releaseTo: 'escalation:cycle-9' })
    await awaitDoctorRepair(started.operationId)
    expect(incidentHolder(incidentId)).toBe('escalation:cycle-9')
    resetIncidentReservationsForTests()
  })

  it('an ATTACHING caller\'s releaseTo is honoured by the running twin\'s settle (#896 review)', async () => {
    resetIncidentReservationsForTests()
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    const incidentId = plan.items[0].incidentIds[0]!
    let releaseApply!: () => void
    applyBarrier = new Promise<void>((resolve) => { releaseApply = resolve })
    const options = { contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId, itemIds: [plan.items[0].id], confirmedItemIds: [], origin: 'web' as const }
    const first = await startDoctorRepair(options) // a UI apply: no hand-back
    const second = await startDoctorRepair({ ...options, origin: 'system', releaseTo: 'escalation:cycle-3' }) // escalation attaches
    expect(second).toMatchObject({ operationId: first.operationId, attached: true })
    releaseApply()
    await awaitDoctorRepair(first.operationId)
    expect(incidentHolder(incidentId)).toBe('escalation:cycle-3')
    resetIncidentReservationsForTests()
  })

  it('answers immediately while an action is still blocked (the 202 never waits for the repair)', async () => {
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    let releaseApply!: () => void
    applyBarrier = new Promise<void>((resolve) => { releaseApply = resolve })
    const startedAt = Date.now()
    const started = await startDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId, itemIds: [plan.items[0].id], confirmedItemIds: [], origin: 'web' })
    expect(Date.now() - startedAt).toBeLessThan(500)
    expect(getOperationRegistry().get(started.operationId)?.status).toBe('running')
    releaseApply()
    await awaitDoctorRepair(started.operationId)
  })

  it('runs as a parent with one child per action, verifies, and keeps the report as the result body', async () => {
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    const started = await startDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId, itemIds: [plan.items[0].id], confirmedItemIds: [], origin: 'cli' })
    const { view, report: body } = await awaitDoctorRepair(started.operationId)
    expect(view).toMatchObject({ kind: 'repair', origin: 'cli', href: '/health', status: 'succeeded', outcome: { code: 'ok' } })
    expect(view.stages.map((stage) => [stage.id, stage.status])).toEqual([['apply', 'done'], ['verify', 'done']])
    expect(view.children).toHaveLength(1)
    const child = getOperationRegistry().get(view.children[0]!)!
    expect(child).toMatchObject({ parentId: view.id, kind: 'repair:repair-test.restart-search', title: 'Restart Search', status: 'succeeded', origin: 'cli' })
    expect(body?.planId).toBe(plan.planId)
    expect(body?.remainingIncidentIds).toEqual([])
    // Route parity: clients read result.body exactly as they read the old 200.
    const parity = healthRepairApplyReportSchema.safeParse(body)
    expect(parity.success ? [] : parity.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)).toEqual([])
  })

  it('reports verification_failed when the repair ran but the incident still reproduces, rows kept', async () => {
    applyAction.mockImplementationOnce(async (items: any[]) => items.map((item) => ({
      itemId: item.id, actionId: item.actionId, status: 'applied' as const, message: 'Tried.', affectedCheckIds: ['repair-test.search'], changes: item.changes,
    })))
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    const started = await startDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId, itemIds: [plan.items[0].id], confirmedItemIds: [], origin: 'web' })
    const { view, report: body } = await awaitDoctorRepair(started.operationId)
    expect(view).toMatchObject({ status: 'failed', outcome: { code: 'verification_failed' } })
    expect(body?.results[0]?.status).toBe('applied')
    expect(body?.remainingIncidentIds.length).toBe(1)
  })

  it('an originating check that disappears during the repair is not verification: verification_failed, never ok (R4)', async () => {
    applyAction.mockImplementationOnce(async (items: any[]) => {
      unhealthy = false
      unregisterHealthCheck('repair-test.search')
      return items.map((item) => ({
        itemId: item.id, actionId: item.actionId, status: 'applied' as const, message: 'Restarted Search.', affectedCheckIds: ['repair-test.search'], changes: item.changes,
      }))
    })
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    const started = await startDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId, itemIds: [plan.items[0].id], confirmedItemIds: [], origin: 'web' })
    const { view, report: body } = await awaitDoctorRepair(started.operationId)
    expect(body?.remainingIncidentIds).toEqual([])
    expect(view).toMatchObject({ status: 'failed', outcome: { code: 'verification_failed' } })
    expect(view.outcome?.message).toContain('could not confirm')
  })

  it('one action applying an item and failing another is partially applied, child and parent alike', async () => {
    planResultOverride = ['a', 'b'].map((id) => ({
      id, actionId: 'restart-search', title: `Step ${id}`, reason: 'Search is unavailable.',
      incidentIds: [], observationIds: [], preconditions: [],
      changes: [{ kind: 'service', target: 'search', action: 'invoke', description: `Step ${id}.` }],
    }))
    applyAction.mockImplementationOnce(async (items: any[]) => items.map((item, index) => ({
      itemId: item.id, actionId: item.actionId, status: index === 0 ? 'applied' as const : 'failed' as const,
      message: index === 0 ? 'Done.' : 'Broke.', affectedCheckIds: [], changes: item.changes,
    })))
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    const started = await startDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId, itemIds: plan.items.map((item) => item.id), confirmedItemIds: [], origin: 'web' })
    const { view, report: body } = await awaitDoctorRepair(started.operationId)
    expect(getOperationRegistry().get(view.children[0]!)).toMatchObject({ status: 'failed', outcome: { code: 'partially_applied' } })
    expect(view).toMatchObject({ status: 'failed', outcome: { code: 'partially_applied' } })
    expect(body?.results.map((row) => row.status)).toEqual(['applied', 'failed'])
  })

  it('an action unregistered between validation and execution fails the parent, never a silent success', async () => {
    registerPluginHealthRepairAction('repair-test', {
      id: 'zz-later', name: 'Later repair', effects: NONE, mutation: 'none',
      operationPlan: () => ({ stages: [{ id: 'apply', kind: 'installing' as const, label: 'Apply' }], pointOfNoReturn: 'apply' }),
      plan: async () => [{ id: 'later', actionId: 'zz-later', title: 'Later', reason: 'r', incidentIds: [], observationIds: [], preconditions: [], changes: [] }],
      apply: async () => { throw new Error('never runs') },
    })
    const id = registerPluginHealthCheck('repair-test', {
      id: 'later-check', name: 'Later check', description: 'd', group: { key: 'system', label: 'System' },
      incidents: [{ id: 'broken', subjectKind: 'system', resolution: { type: 'repair', actionId: 'repair-test.zz-later' }, required: 'always' }],
      run: async () => healthObserved([healthError({ key: 'broken', summary: 'Broken.', incident: {
        key: 'broken', title: 'Broken', impact: 'i', disposition: 'action_required',
        subject: { kind: 'system', id: 'later' }, declarationId: 'broken',
        resolution: { key: 'later', type: 'repair', label: 'Fix', actionId: 'repair-test.zz-later' },
      } })]),
    })
    applyHealthCheckRun(await runHealthCheck(getHealthCheck(id)!, { executionId: () => 'execution-later' }))
    // The first action's run unloads the second before its turn comes.
    applyAction.mockImplementationOnce(async (items: any[]) => {
      unregisterHealthRepairAction('repair-test.zz-later')
      return items.map((item) => ({ itemId: item.id, actionId: item.actionId, status: 'applied' as const, message: 'Restarted Search.', affectedCheckIds: [], changes: item.changes }))
    })
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    expect(plan.items.map((item) => item.actionId)).toEqual(['repair-test.restart-search', 'repair-test.zz-later'])
    const started = await startDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId, itemIds: plan.items.map((item) => item.id), confirmedItemIds: [], origin: 'web' })
    const { view, report: body } = await awaitDoctorRepair(started.operationId)
    expect(body?.results.map((row) => [row.actionId, row.status])).toEqual([['repair-test.restart-search', 'applied'], ['repair-test.zz-later', 'failed']])
    expect(view).toMatchObject({ status: 'failed', outcome: { code: 'partially_applied' } })
  })

  it('cancels before the action passes its point of no return: nothing applied, cancelled', async () => {
    unregisterPluginHealthChecks('repair-test')
    resetHealthReportCache()
    clearStoredRepairPlans()
    let entered!: () => void
    const inPrepare = new Promise<void>((resolve) => { entered = resolve })
    registerPluginHealthRepairAction('repair-test', {
      id: 'slow', name: 'Slow repair', effects: NONE, mutation: 'none',
      operationPlan: () => ({ stages: [{ id: 'prepare', kind: 'preparing' as const, label: 'Prepare' }, { id: 'apply', kind: 'installing' as const, label: 'Apply' }], pointOfNoReturn: 'apply' }),
      plan: async () => [{ id: 'slow', actionId: 'slow', title: 'Slow', reason: 'r', incidentIds: [], observationIds: [], preconditions: [], changes: [] }],
      apply: async (items, op) => {
        op.stage('prepare')
        entered()
        await new Promise<void>((resolve) => op.signal.addEventListener('abort', () => resolve()))
        op.stage('apply')
        return items.map((item) => ({ itemId: item.id, actionId: item.actionId, status: 'applied' as const, message: 'x', affectedCheckIds: [], changes: [] }))
      },
    })
    const id = registerPluginHealthCheck('repair-test', {
      id: 'slow-check', name: 'Slow check', description: 'd', group: { key: 'system', label: 'System' },
      incidents: [{ id: 'broken', subjectKind: 'system', resolution: { type: 'repair', actionId: 'slow' }, required: 'always' }],
      run: async () => healthObserved([healthError({ key: 'broken', summary: 'Broken.', incident: {
        key: 'broken', title: 'Broken', impact: 'i', disposition: 'action_required',
        subject: { kind: 'system', id: 'slow' }, declarationId: 'broken',
        resolution: { key: 'slow', type: 'repair', label: 'Fix', actionId: 'slow' },
      } })]),
    })
    applyHealthCheckRun(await runHealthCheck(getHealthCheck(id)!, { executionId: () => 'execution-slow' }))
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    const started = await startDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId, itemIds: [plan.items[0].id], confirmedItemIds: [], origin: 'web' })
    await inPrepare
    expect(getOperationRegistry().cancel(started.operationId)).toBe('cancelling')
    const { view, report: body } = await awaitDoctorRepair(started.operationId)
    expect(view).toMatchObject({ status: 'cancelled', outcome: { code: 'cancelled' } })
    expect(body).toBeNull()
  })

  it('requires individual confirmation for one-click items (effects that delete content)', async () => {
    unregisterPluginHealthChecks('repair-test')
    resetHealthReportCache()
    clearStoredRepairPlans()
    registerPluginHealthRepairAction('repair-test', {
      id: 'manual', name: 'Manual repair', effects: DEL, mutation: 'delete',
      operationPlan: () => ({ stages: [{ id: 'apply', kind: 'installing' as const, label: 'Apply' }], pointOfNoReturn: 'apply' }),
      plan: async () => [{ id: 'manual', actionId: 'manual', title: 'Manual repair', reason: 'Needs review.', incidentIds: [], observationIds: [], preconditions: [], changes: [] }],
      apply: applyAction,
    })
    const id = registerPluginHealthCheck('repair-test', {
      id: 'manual-check', name: 'Manual check', description: 'Manual repair test.', group: { key: 'system', label: 'System' },
      incidents: [{ id: 'broken', subjectKind: 'system', resolution: { type: 'repair', actionId: 'manual' }, required: 'always' }],
      run: async () => healthObserved([healthError({ key: 'broken', summary: 'Broken.', incident: {
        key: 'broken', title: 'Broken', impact: 'Needs repair.', disposition: 'action_required',
        subject: { kind: 'system', id: 'manual' }, declarationId: 'broken',
        resolution: { key: 'manual', type: 'repair', label: 'Review', actionId: 'manual' },
      } })]),
    })
    applyHealthCheckRun(await runHealthCheck(getHealthCheck(id)!, { executionId: () => 'execution-manual' }))
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    await expect(applyDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId, itemIds: [plan.items[0].id], confirmedItemIds: [] }))
      .rejects.toMatchObject({ httpStatus: 409, body: { code: 'CONFIRMATION_REQUIRED', itemIds: [plan.items[0].id] } })
  })
})

describe('three outcomes: effects, mode and the ONE authorization gate (self-healing 1.7)', () => {
  it('stamps the action\'s effects and the policy\'s mode on every canonical item; a stricter per-item effect wins', async () => {
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    expect(plan.items[0]).toMatchObject({ effects: NONE, mode: 'self-heal' })
    expect(appendAudit).toHaveBeenCalledWith('/tmp/content', 'doctor.fix.planned', 'system', expect.objectContaining({ selfHeal: 1, oneClick: 0 }))

    clearStoredRepairPlans()
    planResultOverride = [{
      id: 'restart', actionId: 'restart-search', title: 'Restart Search', reason: 'Search is unavailable.', effects: DEL,
      incidentIds: [], observationIds: [], preconditions: [], changes: [],
    }]
    const stricter = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    expect(stricter.items[0]).toMatchObject({ effects: DEL, mode: 'one-click' })
  })

  it('an unattended upgrade is refused consent-unreviewed and skipped — never a failed attempt; the operator may apply; an action without a mutation is untouched', async () => {
    const upgradeApply = mock(async (items: any[]) => items.map((item) => ({ itemId: item.id, actionId: item.actionId, status: 'applied' as const, message: 'Upgraded.', affectedCheckIds: ['repair-test.upgrade-check'], changes: item.changes })))
    registerPluginHealthRepairAction('repair-test', {
      id: 'upgrade-x', name: 'Upgrade x', effects: NONE, mutation: 'upgrade',
      operationPlan: () => ({ stages: [{ id: 'apply', kind: 'installing' as const, label: 'Apply' }], pointOfNoReturn: 'apply' }),
      plan: async () => [{ id: 'upgrade', actionId: 'upgrade-x', title: 'Upgrade x', reason: 'A newer release is required.', incidentIds: [], observationIds: [], preconditions: [], changes: [] }],
      apply: upgradeApply,
    })
    let stranded = true
    const id = registerPluginHealthCheck('repair-test', {
      id: 'upgrade-check', name: 'Upgrade check', description: 'd', group: { key: 'plugins', label: 'Plugins' },
      incidents: [{ id: 'stranded', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'upgrade-x' }, required: 'always' }],
      run: async () => healthObserved(stranded ? [healthError({ key: 'x', summary: 'x is stranded.', incident: {
        key: 'stranded', title: 'x is stranded', impact: 'It cannot load.', disposition: 'action_required',
        subject: { kind: 'plugin', id: 'x' }, declarationId: 'stranded',
        resolution: { key: 'upgrade', type: 'repair', label: 'Upgrade', actionId: 'upgrade-x' },
      } })] : [healthHealthy({ key: 'x', summary: 'x is fine.' })]),
    })
    applyHealthCheckRun(await runHealthCheck(getHealthCheck(id)!, { executionId: () => 'execution-upgrade' }))

    const planFor = async () => {
      const report = getHealthReport()
      return planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    }
    const run = async (plan: Awaited<ReturnType<typeof planFor>>, origin: 'system' | 'web', actingAgentId?: string) => {
      const started = await startDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId, itemIds: plan.items.map((item) => item.id), confirmedItemIds: [], origin, ...(actingAgentId ? { actingAgentId } : {}) })
      const { view, report } = await awaitDoctorRepair(started.operationId)
      return { view, rows: report!.results }
    }

    // System actor (the old escalation's auto-apply): the plain restart runs, the upgrade is handed to the operator.
    const system = await run(await planFor(), 'system')
    expect(system.rows.map((row) => [row.actionId, row.status])).toEqual([['repair-test.restart-search', 'applied'], ['repair-test.upgrade-x', 'skipped']])
    expect(system.rows[1]).toMatchObject({ authorization: { refused: true, reason: 'consent-unreviewed' } })
    expect(system.rows[1]!.message).toContain('Your approval is needed before automatic updates')
    expect(upgradeApply).not.toHaveBeenCalled()
    expect(system.view.status).not.toBe('failed')

    // An agent acting for its task is unattended too.
    unhealthy = true
    applyHealthCheckRun(await runHealthCheck(getHealthCheck('repair-test.search')!, { executionId: () => 'execution-2' }))
    const agent = await run(await planFor(), 'web', 'main')
    expect(agent.rows.find((row) => row.actionId === 'repair-test.upgrade-x')).toMatchObject({ status: 'skipped', authorization: { reason: 'consent-unreviewed' } })
    expect(upgradeApply).not.toHaveBeenCalled()

    // The operator's click passes the gate.
    unhealthy = true
    applyHealthCheckRun(await runHealthCheck(getHealthCheck('repair-test.search')!, { executionId: () => 'execution-3' }))
    stranded = false
    const operator = await run(await planFor(), 'web')
    expect(operator.rows.find((row) => row.actionId === 'repair-test.upgrade-x')).toMatchObject({ status: 'applied' })
    expect(upgradeApply).toHaveBeenCalledTimes(1)
  })
})
