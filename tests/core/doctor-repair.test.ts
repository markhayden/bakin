import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { healthError, healthHealthy, healthObserved } from '@makinbakin/sdk/utils'

const appendAudit = mock()
mock.module('../../src/core/audit', () => ({ appendAudit }))
mock.module('../../src/core/settings', () => ({
  getSettings: () => ({ doctor: { intervalMs: 60_000, requireOnboard: false, escalation: 'off', escalationCooldownMs: 60_000 } }),
}))
mock.module('../../src/core/onboarding/state', () => ({ isOnboarded: () => true }))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) }))

import { applyHealthCheckRun, getHealthReport, resetHealthReportCache } from '../../src/core/doctor-report-cache'
import { runHealthCheck } from '../../src/core/doctor-checks'
import { applyDoctorRepair, planDoctorRepair } from '../../src/core/doctor-repair'
import { clearStoredRepairPlans, DoctorRepairConfirmationError, DoctorRepairStalePlanError } from '../../src/core/doctor-repair-plans'
import {
  getHealthCheck,
  registerPluginHealthCheck,
  registerPluginHealthRepairAction,
  unregisterHealthCheck,
  unregisterPluginHealthChecks,
} from '../../src/core/health-check-registry'

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
    plan: async () => planResultOverride !== undefined
      ? planResultOverride as any
      : [{
          id: 'restart', actionId: 'restart-search', title: 'Restart Search', reason: 'Search is unavailable.', safety: 'safe',
          incidentIds: [], observationIds: [], preconditions: [],
          changes: [{ kind: 'service', target: 'search', action: 'invoke', description: 'Restart Search.' }],
        }],
    apply: applyAction,
  })
  const id = registerPluginHealthCheck('repair-test', {
    id: 'search', name: 'Search readiness', description: 'Checks Search availability.', group: { key: 'search', label: 'Search' },
    run: async () => healthObserved(unhealthy ? [healthError({
      key: 'engine', summary: 'Search is unavailable.',
      incident: {
        key: 'unavailable', title: 'Search is unavailable', impact: 'Search requests fail.', disposition: 'action_required',
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
      actionId: 'repair-test.restart-search',
      observationIds: ['repair-test.search:engine'],
      preconditions: [{ observationId: 'repair-test.search:engine', executionId: 'execution-1', status: 'error', resolutionKey: 'restart' }],
    })
  })

  it('rejects malformed plan output without retaining its payload', async () => {
    const secret = 'plan-output-must-not-leak'
    planResultOverride = [{
      id: 'restart', actionId: 'restart-search', title: 'Restart Search', reason: 'Search is unavailable.', safety: 'safe',
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
    expect(result.verifiedIncidentIds).toEqual([])
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
    await expect(applyDoctorRepair({
      contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId,
      itemIds: [plan.items[0].id], confirmedItemIds: [],
    })).rejects.toBeInstanceOf(DoctorRepairStalePlanError)
    expect(applyAction).not.toHaveBeenCalled()
  })

  it('allows only one concurrent application to claim a repair plan', async () => {
    const report = getHealthReport()
    const plan = await planDoctorRepair({
      contentDir: '/tmp/content', projectRoot: '/tmp/project',
      target: { type: 'all_actionable', reportId: report.id },
    })
    let releaseApply!: () => void
    applyBarrier = new Promise<void>((resolve) => { releaseApply = resolve })
    const options = {
      contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId,
      itemIds: [plan.items[0].id], confirmedItemIds: [],
    }

    const first = applyDoctorRepair(options)
    await Promise.resolve()
    const second = applyDoctorRepair(options)
    const settledPromise = Promise.allSettled([first, second])
    await Promise.resolve()
    const applyCallsBeforeRelease = applyAction.mock.calls.length
    releaseApply()
    const settled = await settledPromise

    expect(applyCallsBeforeRelease).toBe(1)
    expect(settled[0].status).toBe('fulfilled')
    expect(settled[1]).toMatchObject({ status: 'rejected', reason: expect.any(DoctorRepairStalePlanError) })
  })

  it('requires individual confirmation for non-safe items', async () => {
    unregisterPluginHealthChecks('repair-test')
    resetHealthReportCache()
    clearStoredRepairPlans()
    registerPluginHealthRepairAction('repair-test', {
      id: 'manual', name: 'Manual repair',
      plan: async () => [{ id: 'manual', actionId: 'manual', title: 'Manual repair', reason: 'Needs review.', safety: 'manual', incidentIds: [], observationIds: [], preconditions: [], changes: [] }],
      apply: applyAction,
    })
    const id = registerPluginHealthCheck('repair-test', {
      id: 'manual-check', name: 'Manual check', description: 'Manual repair test.', group: { key: 'system', label: 'System' },
      run: async () => healthObserved([healthError({ key: 'broken', summary: 'Broken.', incident: {
        key: 'broken', title: 'Broken', impact: 'Needs repair.', disposition: 'action_required',
        resolution: { key: 'manual', type: 'repair', label: 'Review', actionId: 'manual' },
      } })]),
    })
    applyHealthCheckRun(await runHealthCheck(getHealthCheck(id)!, { executionId: () => 'execution-manual' }))
    const report = getHealthReport()
    const plan = await planDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', target: { type: 'all_actionable', reportId: report.id } })
    await expect(applyDoctorRepair({ contentDir: '/tmp/content', projectRoot: '/tmp/project', planId: plan.planId, itemIds: [plan.items[0].id], confirmedItemIds: [] })).rejects.toBeInstanceOf(DoctorRepairConfirmationError)
  })
})
