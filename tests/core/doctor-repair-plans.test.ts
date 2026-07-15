import { beforeEach, describe, expect, it } from 'bun:test'
import type { HealthRepairPlanItem, HealthReport } from '@makinbakin/sdk/types'
import {
  clearStoredRepairPlans,
  createStoredRepairPlan,
  DoctorRepairConfirmationError,
  DoctorRepairStalePlanError,
  getStoredRepairPlan,
  MAX_STORED_REPAIR_PLANS,
  PLAN_TTL_MS,
  validateRepairApplication,
} from '../../src/core/doctor-repair-plans'

const now = new Date('2026-07-13T12:00:00.000Z')

function item(overrides: Partial<HealthRepairPlanItem> = {}): HealthRepairPlanItem {
  return {
    id: 'restart-search',
    actionId: 'health.restart-search',
    title: 'Restart Search',
    reason: 'The engine is unavailable.',
    safety: 'safe',
    incidentIds: ['health:search:unavailable'],
    observationIds: ['health.search:engine'],
    preconditions: [{
      observationId: 'health.search:engine',
      executionId: 'execution-1',
      status: 'error',
      resolutionKey: 'restart',
    }],
    changes: [{ kind: 'service', target: 'search', action: 'invoke', description: 'Restart Search.' }],
    ...overrides,
  }
}

function report(overrides: Partial<HealthReport> = {}): HealthReport {
  const observation = {
    id: 'health.search:engine',
    key: 'engine',
    status: 'error' as const,
    summary: 'Search is unavailable.',
    checkId: 'health.search',
    checkName: 'Search readiness',
    owner: { kind: 'plugin' as const, id: 'health', label: 'Health' },
    group: { key: 'search', label: 'Search' },
    checkedAt: now.toISOString(),
    observedAt: now.toISOString(),
    staleAt: new Date(now.getTime() + 60_000).toISOString(),
    snapshot: 'current' as const,
    incidentId: 'health:search:unavailable',
    incident: {
      key: 'unavailable', title: 'Search is unavailable', impact: 'Search fails.', disposition: 'action_required' as const,
      resolution: { key: 'restart', type: 'repair' as const, label: 'Restart', actionId: 'health.restart-search' },
    },
  }
  return {
    id: 'health-report-1', revision: 1, generatedAt: now.toISOString(), overallStatus: 'needs_attention', lastFullSweep: null,
    checks: [{
      checkId: 'health.search', checkName: 'Search readiness', description: 'Checks Search.',
      owner: observation.owner, group: observation.group,
      latestExecution: { id: 'execution-1', checkId: 'health.search', startedAt: now.toISOString(), completedAt: now.toISOString(), outcome: 'observed' },
      latestValidSnapshot: { executionId: 'execution-1', observations: [observation] },
    }],
    observations: [observation],
    incidents: [{
      id: observation.incidentId, status: 'error', disposition: 'action_required', title: 'Search is unavailable', impact: 'Search fails.',
      resources: [], resolution: observation.incident.resolution, observationIds: [observation.id],
      observedAt: now.toISOString(), staleAt: observation.staleAt, stale: false,
    }],
    subsystems: { search: { status: 'unhealthy', summary: 'Search unavailable.', observedAt: now.toISOString(), staleAt: observation.staleAt, stages: [], incidentIds: [observation.incidentId] } },
    summary: { checks: { registered: 1, completed: 1, failed: 0, invalid: 0, notApplicable: 0 }, incidents: { actionRequired: 1, watching: 0, advisory: 0, unknown: 0 } },
    ...overrides,
  }
}

beforeEach(clearStoredRepairPlans)

describe('server-held repair plan validation', () => {
  it('creates an opaque ten-minute plan and accepts unchanged safe evidence', () => {
    const plan = createStoredRepairPlan({ basedOnReportId: 'health-report-1', target: { type: 'all_actionable', reportId: 'health-report-1' }, items: [item()] }, now)
    expect(plan.planId).toMatch(/^repair-plan-/)
    expect(Date.parse(plan.expiresAt) - Date.parse(plan.createdAt)).toBe(PLAN_TTL_MS)
    expect(validateRepairApplication({ planId: plan.planId, itemIds: [item().id], confirmedItemIds: [], report: report(), now }).items).toHaveLength(1)
  })

  it('allows unrelated report revision changes', () => {
    const plan = createStoredRepairPlan({ basedOnReportId: 'health-report-1', target: { type: 'all_actionable', reportId: 'health-report-1' }, items: [item()] }, now)
    expect(() => validateRepairApplication({
      planId: plan.planId, itemIds: [item().id], confirmedItemIds: [],
      report: report({ id: 'health-report-2', revision: 2 }), now,
    })).not.toThrow()
  })

  it('rejects expiry or changed/resolved/replaced targets before execution', () => {
    const make = () => createStoredRepairPlan({ basedOnReportId: 'health-report-1', target: { type: 'all_actionable', reportId: 'health-report-1' }, items: [item()] }, now)
    expect(() => validateRepairApplication({ planId: make().planId, itemIds: [item().id], confirmedItemIds: [], report: report(), now: new Date(now.getTime() + PLAN_TTL_MS) })).toThrow(DoctorRepairStalePlanError)
    expect(() => validateRepairApplication({ planId: make().planId, itemIds: [item().id], confirmedItemIds: [], report: report({ observations: [] }), now })).toThrow(DoctorRepairStalePlanError)
    const changed = report()
    changed.observations[0] = { ...changed.observations[0], incident: { ...changed.observations[0].incident!, resolution: { key: 'different', type: 'rerun', label: 'Retry' } } } as any
    expect(() => validateRepairApplication({ planId: make().planId, itemIds: [item().id], confirmedItemIds: [], report: changed, now })).toThrow(DoctorRepairStalePlanError)
  })

  it('requires individual confirmation for every selected non-safe item', () => {
    const manual = item({ id: 'manual', safety: 'manual' })
    const destructive = item({ id: 'destructive', safety: 'destructive' })
    const plan = createStoredRepairPlan({ basedOnReportId: 'health-report-1', target: { type: 'all_actionable', reportId: 'health-report-1' }, items: [manual, destructive] }, now)
    expect(() => validateRepairApplication({ planId: plan.planId, itemIds: ['manual', 'destructive'], confirmedItemIds: ['manual'], report: report(), now })).toThrow(DoctorRepairConfirmationError)
  })

  it('rejects client-invented or duplicate item selections', () => {
    const plan = createStoredRepairPlan({ basedOnReportId: 'health-report-1', target: { type: 'all_actionable', reportId: 'health-report-1' }, items: [item()] }, now)
    for (const ids of [[], ['invented'], [item().id, item().id]]) {
      expect(() => validateRepairApplication({ planId: plan.planId, itemIds: ids, confirmedItemIds: [], report: report(), now })).toThrow(DoctorRepairStalePlanError)
    }
  })

  it('prunes abandoned expired plans when a later plan is created or read', () => {
    const abandoned = createStoredRepairPlan({ basedOnReportId: 'health-report-1', target: { type: 'all_actionable', reportId: 'health-report-1' }, items: [item()] }, now)
    const later = new Date(now.getTime() + PLAN_TTL_MS)

    createStoredRepairPlan({ basedOnReportId: 'health-report-2', target: { type: 'all_actionable', reportId: 'health-report-2' }, items: [item()] }, later)

    expect(getStoredRepairPlan(abandoned.planId, later)).toBeUndefined()
  })

  it('bounds abandoned plans and evicts the oldest plan first', () => {
    const created = Array.from({ length: MAX_STORED_REPAIR_PLANS + 1 }, (_, index) => (
      createStoredRepairPlan({ basedOnReportId: `health-report-${index}`, target: { type: 'all_actionable', reportId: `health-report-${index}` }, items: [item()] }, now)
    ))

    expect(getStoredRepairPlan(created[0]!.planId, now)).toBeUndefined()
    expect(getStoredRepairPlan(created.at(-1)!.planId, now)).toBeDefined()
  })
})
