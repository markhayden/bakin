/**
 * Budget policy + evaluation — the spend ceiling dispatch consults before
 * claiming a run. Pure logic: the caller supplies the spend in each (scope,
 * window) from the ledger, and this decides allow / warn / defer. Bakin owns
 * the gate (it's dispatch coordination); the models plugin owns the policy
 * storage + UI (read via a hook).
 *
 * Diverges from paperclip deliberately: a breach DEFERS the run (the task
 * stays claimable and resumes when the window rolls over or the cap is
 * raised) rather than pausing the agent — no work is lost, spend just
 * throttles. Windows are calendar day + calendar month in LOCAL time: daily
 * catches a runaway night fast; monthly roughly tracks a billing month but is
 * NOT invoice-exact — it resets at local (not UTC) midnight and the cost is an
 * estimate that omits cached-token discounts, so it reads slightly high.
 */

export interface BudgetCaps {
  /** Cap in whole US dollars; omit for unlimited on that window. */
  dailyUsd?: number
  monthlyUsd?: number
}

export interface BudgetPolicy {
  /** Caps applied to total spend across all agents, plus the warn threshold. */
  global?: BudgetCaps & { warnPct?: number }
  /** Per-agent caps, keyed by agent id. */
  perAgent?: Record<string, BudgetCaps>
}

/** Ledger-sourced spend (micro-dollars) for each scope × window. */
export interface BudgetSpend {
  globalDayMicros: number
  globalMonthMicros: number
  agentDayMicros: number
  agentMonthMicros: number
}

export type BudgetScope = 'global' | 'agent'
export type BudgetWindow = 'daily' | 'monthly'

export type BudgetDecision =
  | { action: 'allow' }
  | { action: 'warn'; scope: BudgetScope; window: BudgetWindow; spentUsdMicros: number; capUsdMicros: number }
  | { action: 'defer'; scope: BudgetScope; window: BudgetWindow; spentUsdMicros: number; capUsdMicros: number }

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

interface Cap {
  scope: BudgetScope
  window: BudgetWindow
  capUsdMicros: number
  spentUsdMicros: number
}

/**
 * Decide whether a turn may dispatch. defer (any cap met or exceeded) beats
 * warn (any cap at/over the warn threshold) beats allow. The returned breach
 * is the worst one, for the audit reason. No caps set → always allow.
 */
export function evaluateBudget(input: {
  policy: BudgetPolicy
  agent: string
  spend: BudgetSpend
}): BudgetDecision {
  const { policy, spend } = input
  const warnPct = policy.global?.warnPct ?? DEFAULT_WARN_PCT
  const agentCaps = policy.perAgent?.[input.agent]

  const caps: Cap[] = []
  const push = (usd: number | undefined, scope: BudgetScope, window: BudgetWindow, spentUsdMicros: number) => {
    if (typeof usd === 'number' && usd > 0) caps.push({ scope, window, capUsdMicros: Math.round(usd * 1_000_000), spentUsdMicros })
  }
  push(policy.global?.dailyUsd, 'global', 'daily', spend.globalDayMicros)
  push(policy.global?.monthlyUsd, 'global', 'monthly', spend.globalMonthMicros)
  push(agentCaps?.dailyUsd, 'agent', 'daily', spend.agentDayMicros)
  push(agentCaps?.monthlyUsd, 'agent', 'monthly', spend.agentMonthMicros)

  const exceeded = caps.find((c) => c.spentUsdMicros >= c.capUsdMicros)
  if (exceeded) {
    return { action: 'defer', scope: exceeded.scope, window: exceeded.window, spentUsdMicros: exceeded.spentUsdMicros, capUsdMicros: exceeded.capUsdMicros }
  }
  const warning = caps.find((c) => c.spentUsdMicros >= c.capUsdMicros * warnPct)
  if (warning) {
    return { action: 'warn', scope: warning.scope, window: warning.window, spentUsdMicros: warning.spentUsdMicros, capUsdMicros: warning.capUsdMicros }
  }
  return { action: 'allow' }
}
