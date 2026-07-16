import type {
  HealthRepairPlan,
  HealthRepairPlanItem,
  HealthReport,
} from '../../packages/core/src/plugin-types'

const PLAN_TTL_MS = 10 * 60_000
const MAX_STORED_REPAIR_PLANS = 100
const plans = new Map<string, HealthRepairPlan>()

function pruneStoredRepairPlans(nowMs: number): void {
  for (const [planId, plan] of plans) {
    if (Date.parse(plan.expiresAt) <= nowMs) plans.delete(planId)
  }
  while (plans.size > MAX_STORED_REPAIR_PLANS) {
    const oldestPlanId = plans.keys().next().value
    if (typeof oldestPlanId !== 'string') break
    plans.delete(oldestPlanId)
  }
}

export class DoctorRepairStalePlanError extends Error {
  readonly code = 'STALE_PLAN'

  constructor(message = 'The repair plan is stale. Refresh Health and plan the repair again.') {
    super(message)
    this.name = 'DoctorRepairStalePlanError'
  }
}

export class DoctorRepairConfirmationError extends Error {
  readonly code = 'CONFIRMATION_REQUIRED'

  constructor(readonly itemIds: string[]) {
    super('Manual or destructive repair items require individual confirmation.')
    this.name = 'DoctorRepairConfirmationError'
  }
}

export function createStoredRepairPlan(
  input: Omit<HealthRepairPlan, 'planId' | 'createdAt' | 'expiresAt'>,
  now = new Date(),
): HealthRepairPlan {
  pruneStoredRepairPlans(now.getTime())
  const plan: HealthRepairPlan = {
    ...structuredClone(input),
    planId: `repair-plan-${crypto.randomUUID()}`,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
  }
  plans.set(plan.planId, plan)
  pruneStoredRepairPlans(now.getTime())
  return structuredClone(plan)
}

export function getStoredRepairPlan(planId: string, now = new Date()): HealthRepairPlan | undefined {
  pruneStoredRepairPlans(now.getTime())
  const plan = plans.get(planId)
  return plan ? structuredClone(plan) : undefined
}

function executionIdForObservation(report: HealthReport, observationId: string): string | null {
  for (const check of report.checks) {
    const snapshot = check.latestValidSnapshot
    if (snapshot?.observations.some((observation) => observation.id === observationId)) {
      return snapshot.executionId
    }
  }
  return null
}

function assertPreconditions(item: HealthRepairPlanItem, report: HealthReport): void {
  for (const precondition of item.preconditions) {
    const observation = report.observations.find((row) => row.id === precondition.observationId)
    if (!observation || observation.status === 'healthy') throw new DoctorRepairStalePlanError()
    if (observation.status !== precondition.status) throw new DoctorRepairStalePlanError()
    if (observation.incident.resolution.key !== precondition.resolutionKey) {
      throw new DoctorRepairStalePlanError()
    }
    if (executionIdForObservation(report, observation.id) !== precondition.executionId) {
      throw new DoctorRepairStalePlanError()
    }
  }
}

export interface ValidatedRepairApplication {
  plan: HealthRepairPlan
  items: HealthRepairPlanItem[]
}

/** Pure validation boundary: callers invoke actions only after this succeeds. */
export function validateRepairApplication(input: {
  planId: string
  itemIds: readonly string[]
  confirmedItemIds: readonly string[]
  report: HealthReport
  now?: Date
}): ValidatedRepairApplication {
  pruneStoredRepairPlans((input.now ?? new Date()).getTime())
  const plan = plans.get(input.planId)
  if (!plan || Date.parse(plan.expiresAt) <= (input.now ?? new Date()).getTime()) {
    if (plan) plans.delete(input.planId)
    throw new DoctorRepairStalePlanError()
  }
  if (input.itemIds.length === 0 || new Set(input.itemIds).size !== input.itemIds.length) {
    throw new DoctorRepairStalePlanError('The repair selection does not match the stored plan.')
  }

  const selected = input.itemIds.map((id) => plan.items.find((item) => item.id === id))
  if (selected.some((item) => !item)) {
    throw new DoctorRepairStalePlanError('The repair selection does not match the stored plan.')
  }
  const items = selected as HealthRepairPlanItem[]
  const confirmed = new Set(input.confirmedItemIds)
  const missingConfirmation = items
    .filter((item) => item.safety !== 'safe' && !confirmed.has(item.id))
    .map((item) => item.id)
  if (missingConfirmation.length > 0) throw new DoctorRepairConfirmationError(missingConfirmation)

  // Validate every target before returning any executable item. This gives
  // the caller a strict zero-mutation stale-plan boundary.
  for (const item of items) assertPreconditions(item, input.report)
  return { plan: structuredClone(plan), items: structuredClone(items) }
}

/** Validate and consume a plan synchronously before any repair action can run. */
export function claimRepairApplication(
  input: Parameters<typeof validateRepairApplication>[0],
): ValidatedRepairApplication {
  const validated = validateRepairApplication(input)
  plans.delete(input.planId)
  return validated
}

export function deleteStoredRepairPlan(planId: string): void {
  plans.delete(planId)
}

export function clearStoredRepairPlans(): void {
  plans.clear()
}

export { MAX_STORED_REPAIR_PLANS, PLAN_TTL_MS }
