/**
 * One-shot migration of the PR #500 budget shape ({global, perAgent} metered
 * dollar caps) into the cost-control v2 rule list. Runs once at plugin
 * activation: a legacy-shaped `budget` setting is mapped to rules, written
 * back, and the old keys are gone. No dual-read path exists anywhere —
 * single-user machine, the mapper + this comment are the only trace.
 */
import type { BudgetPolicy, BudgetRule } from '../../../src/core/budget'

interface LegacyCaps {
  dailyUsd?: number
  monthlyUsd?: number
}
export interface LegacyBudgetPolicy {
  global?: LegacyCaps & { warnPct?: number }
  perAgent?: Record<string, LegacyCaps>
}

/** True when the stored budget is the pre-v2 shape. */
export function isLegacyBudget(budget: unknown): budget is LegacyBudgetPolicy {
  if (budget === null || typeof budget !== 'object') return false
  const b = budget as Record<string, unknown>
  return !('rules' in b) && ('global' in b || 'perAgent' in b)
}

/** Map the legacy shape to rules. Legacy caps were always metered dollars. */
export function migrateLegacyBudget(legacy: LegacyBudgetPolicy): BudgetPolicy {
  const rules: BudgetRule[] = []
  const { global: g, perAgent } = legacy
  if (g && (g.dailyUsd || g.monthlyUsd)) {
    rules.push({
      scope: 'global',
      lane: 'metered',
      ...(g.dailyUsd ? { dailyCap: g.dailyUsd } : {}),
      ...(g.monthlyUsd ? { monthlyCap: g.monthlyUsd } : {}),
      ...(g.warnPct ? { warnPct: g.warnPct } : {}),
    })
  }
  for (const [agentId, caps] of Object.entries(perAgent ?? {})) {
    if (!caps.dailyUsd && !caps.monthlyUsd) continue
    rules.push({
      scope: 'agent',
      scopeId: agentId,
      lane: 'metered',
      ...(caps.dailyUsd ? { dailyCap: caps.dailyUsd } : {}),
      ...(caps.monthlyUsd ? { monthlyCap: caps.monthlyUsd } : {}),
      // The legacy evaluator applied the single global warnPct to EVERY cap.
      ...(g?.warnPct ? { warnPct: g.warnPct } : {}),
    })
  }
  return { rules }
}
