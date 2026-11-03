/**
 * The ONE identity between a budget rule and the incident it opened, plus
 * the cap in the rule's unit — shared by the routes (resolve / reconcile)
 * and the health check (which incident is still blocking dispatch).
 */
import type { BudgetIncidentRow } from '../../../src/core/execution-ledger'
import type { BudgetRule } from '../../../src/core/budget'

export function ruleMatchesIncident(rule: BudgetRule, incident: Pick<BudgetIncidentRow, 'scope' | 'scopeId' | 'lane'>): boolean {
  return rule.scope === incident.scope && (rule.scopeId ?? '') === incident.scopeId && rule.lane === incident.lane
}

/** A cap in the rule's unit (micro-USD for metered, tokens for subscription), or null when the window has no cap. */
export function capInUnit(rule: BudgetRule, window: 'daily' | 'monthly'): number | null {
  const cap = window === 'daily' ? rule.dailyCap : rule.monthlyCap
  if (cap === undefined) return null
  return rule.lane === 'metered' ? Math.round(cap * 1_000_000) : Math.round(cap)
}
