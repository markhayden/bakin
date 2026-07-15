/**
 * Budget policy + evaluation — the spend ceiling dispatch (and the billed-
 * media gate) consults before spending. Pure logic: the caller supplies the
 * spend facets from the engine (budget-spend.ts) and the turn's billing
 * context, and this decides allow / warn / defer. Bakin owns the gate; the
 * models plugin owns policy storage + UI (read via hook).
 *
 * A policy is a list of scoped cap RULES (cost-control v2, #464):
 * global | agent | provider — 'model' is accepted by the evaluator today so
 * extending the UI later is one picker, not a rebuild. Unit-per-lane (V8):
 * a 'metered' rule caps estimated dollars (attributed + unattributed delta);
 * a 'subscription' rule caps tokens (plan quota — dollars there would be
 * fiction). A rule gates a turn only when the turn's scope AND lane match.
 *
 * Diverges from paperclip deliberately: a breach DEFERS the run by default
 * (the task stays claimable and resumes when the window rolls over or the
 * cap is raised); `atCap: 'pause'` opts a rule into paperclip-style
 * hold-until-resolved semantics (enforced at the gate via open incidents).
 * Windows are calendar day + month in LOCAL time: daily catches a runaway
 * night fast; monthly roughly tracks a billing month but is NOT
 * invoice-exact.
 */
import type { BillingLane } from '../../packages/core/src/execution/ledger'

// Spend-facet shapes (produced by budget-spend.ts, consumed by the evaluator
// and every surface). Declared HERE so the policy module is import-acyclic —
// budget-spend re-exports them.
export interface LaneSums {
  /** Estimated metered-lane spend (micro-dollars) — priced rows only. */
  meteredUsdMicros: number
  /** All metered-lane tokens (priced + unpriced). */
  meteredTokens: number
  /** Subscription-lane tokens (the lane's unit; never dollars). */
  subscriptionTokens: number
  /** Metered-lane tokens from rows that carried no dollar estimate. */
  unpricedMeteredTokens: number
}

export interface UnattributedSums {
  meteredUsdMicros: number
  meteredTokens: number
  subscriptionTokens: number
}

export interface ScopeSpend extends LaneSums {
  /** Observed-minus-attributed delta (usage.db vs run_costs), clamped ≥ 0 per agent/day/lane. */
  unattributed: UnattributedSums
}

export interface WindowSpend {
  startMs: number
  global: ScopeSpend
  byAgent: Record<string, ScopeSpend>
  /** Attributed-only rollups (see module header). */
  byProvider: Record<string, LaneSums>
  byModel: Record<string, LaneSums>
}

export interface BudgetSpendFacets {
  computedAt: number
  /** Whether the observed-usage store contributed to these facets. */
  observedUsageEvidence:
    | { status: 'available' }
    | { status: 'unavailable'; reason: 'usage_store_unavailable' }
  daily: WindowSpend
  monthly: WindowSpend
}



export type BudgetScope = 'global' | 'agent' | 'provider' | 'model'
export type BudgetWindow = 'daily' | 'monthly'
export type BudgetUnit = 'usd_micros' | 'tokens'

export interface BudgetRule {
  scope: BudgetScope
  /** Agent id / provider id / model id; absent for global. */
  scopeId?: string
  /** The billing lane this rule caps — determines the unit (V8). */
  lane: BillingLane
  /** Cap per local calendar day: whole USD (metered) or tokens (subscription). */
  dailyCap?: number
  /** Cap per local calendar month, same unit. */
  monthlyCap?: number
  /** Warn threshold as a fraction of the cap (default 0.8). */
  warnPct?: number
  /** At 100%: 'defer' (resumes at window rollover) or 'pause' (holds until resolved). */
  atCap?: 'defer' | 'pause'
}

export interface BudgetPolicy {
  rules?: BudgetRule[]
}

/** Billing context of the turn (or billed call) being gated. */
export interface TurnBillingContext {
  agent: string
  /** Provider the turn will spend on (from models.resolveBilling); unknown = matches no provider rule. */
  provider?: string
  /** Normalized model id; unknown = matches no model rule. */
  model?: string
  /** The turn's billing lane; unknown defaults to metered (conservative). */
  lane?: BillingLane
}

export type BudgetDecision =
  | { action: 'allow' }
  | {
      action: 'warn' | 'defer'
      rule: BudgetRule
      window: BudgetWindow
      unit: BudgetUnit
      spentValue: number
      capValue: number
    }

export const DEFAULT_WARN_PCT = 0.8

/** Local calendar-day start (midnight) at or before `now` (ms). */
export function dayStartMs(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Local calendar-month start (1st, midnight) at or before `now` (ms). */
export function monthStartMs(now: number): number {
  const d = new Date(now)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** True when the rule applies to this turn (scope + lane both match). */
export function ruleMatchesTurn(rule: BudgetRule, turn: TurnBillingContext): boolean {
  const turnLane: BillingLane = turn.lane ?? 'metered'
  if (rule.lane !== turnLane) return false
  switch (rule.scope) {
    case 'global':
      return true
    case 'agent':
      return rule.scopeId === turn.agent
    case 'provider':
      return turn.provider !== undefined && rule.scopeId === turn.provider
    case 'model':
      return turn.model !== undefined && rule.scopeId === turn.model
  }
}

/** The rule's scope spend within one window, in the rule's unit. */
function ruleSpentValue(rule: BudgetRule, w: WindowSpend): number {
  const bucket: ScopeSpend | LaneSums | undefined =
    rule.scope === 'global' ? w.global
    : rule.scope === 'agent' ? w.byAgent[rule.scopeId ?? '']
    : rule.scope === 'provider' ? w.byProvider[rule.scopeId ?? '']
    : w.byModel[rule.scopeId ?? '']
  if (!bucket) return 0
  const unattributed: UnattributedSums | undefined = (bucket as Partial<ScopeSpend>).unattributed
  return rule.lane === 'subscription'
    ? bucket.subscriptionTokens + (unattributed?.subscriptionTokens ?? 0)
    : bucket.meteredUsdMicros + (unattributed?.meteredUsdMicros ?? 0)
}

/** The rule's cap for a window, converted to the spend unit (micros for USD). */
function ruleCapValue(rule: BudgetRule, window: BudgetWindow): number | null {
  const cap = window === 'daily' ? rule.dailyCap : rule.monthlyCap
  if (typeof cap !== 'number' || cap <= 0) return null
  return rule.lane === 'metered' ? Math.round(cap * 1_000_000) : Math.round(cap)
}

const WINDOWS: BudgetWindow[] = ['daily', 'monthly']

/**
 * Decide whether a turn may proceed. Every matching rule is checked across
 * both windows; defer (any cap met or exceeded) beats warn (any cap at/over
 * its warn threshold) beats allow. The returned breach identifies the rule,
 * for the incident/audit. No rules → always allow.
 */
export function evaluateBudget(input: {
  policy: BudgetPolicy
  turn: TurnBillingContext
  facets: BudgetSpendFacets
}): BudgetDecision {
  const rules = input.policy.rules ?? []
  let worstWarn: BudgetDecision | null = null
  for (const rule of rules) {
    if (!ruleMatchesTurn(rule, input.turn)) continue
    for (const window of WINDOWS) {
      const capValue = ruleCapValue(rule, window)
      if (capValue === null) continue
      const spentValue = ruleSpentValue(rule, window === 'daily' ? input.facets.daily : input.facets.monthly)
      const unit: BudgetUnit = rule.lane === 'metered' ? 'usd_micros' : 'tokens'
      if (spentValue >= capValue) {
        return { action: 'defer', rule, window, unit, spentValue, capValue }
      }
      const warnPct = rule.warnPct ?? DEFAULT_WARN_PCT
      if (!worstWarn && spentValue >= capValue * warnPct) {
        worstWarn = { action: 'warn', rule, window, unit, spentValue, capValue }
      }
    }
  }
  return worstWarn ?? { action: 'allow' }
}
