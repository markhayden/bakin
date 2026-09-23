/**
 * Spend plugin — shared types. The wire shapes below are what this plugin's
 * spend, limits, incident and billing routes answer with.
 */
export type SpendTab = 'overview' | 'limits'
export type SpendWindow = '24h' | '7d' | '30d' | 'all'

/** Manual billing-lane override; most-specific match wins (agent+provider → agent → provider). */
export interface BillingOverride {
  agentId?: string
  provider?: string
  lane: 'metered' | 'subscription'
}

/** Wire shape of one budget cap rule (cost-control v2). `id` is server-assigned; absent only on a row staged in the editor. */
export interface BudgetRuleWire {
  id?: string
  /** Client-only: a stable key for a staged (not yet saved) editor row — stripped before the wire. */
  stagedKey?: string
  scope: 'global' | 'agent' | 'provider' | 'model'
  scopeId?: string
  lane: 'metered' | 'subscription'
  dailyCap?: number
  monthlyCap?: number
  atCap?: 'defer' | 'pause'
}
/** One durable breach record (wire shape of a budget_incidents row). */
export interface BudgetIncidentWire {
  id: number
  scope: string
  scopeId: string
  lane: 'metered' | 'subscription'
  window: 'daily' | 'monthly'
  windowStartMs: number
  kind: 'cap'
  unit: 'usd_micros' | 'tokens'
  capValue: number
  spentValue: number
  atCap: 'defer' | 'pause'
  openedAt: number
  status: 'open' | 'acknowledged' | 'resolved'
}

export interface BillingOverrideWire { agentId?: string; provider?: string; lane: 'metered' | 'subscription' }
/** One milestone row of a current window (wire shape of a budget_milestones row the status route serves). */
export interface BudgetMilestoneWire {
  id: number
  ruleId: string
  window: 'daily' | 'monthly'
  milestone: number
  spentValue: number
  capValue: number
  unit: 'usd_micros' | 'tokens'
  acknowledgedAt: number | null
}
/** Wire shape of GET /status (full mode). */
export interface BudgetStatusWire {
  paused: boolean
  milestones?: BudgetMilestoneWire[]
  configured: boolean
  perAgent: Record<string, 'ok' | 'deferred'>
  perTask: Record<string, 'deferred'>
  billing: Record<string, { provider: string; lane: 'metered' | 'subscription'; model: string | null }>
  overrides: BillingOverrideWire[]
  deferredProviders: string[]
  openIncidents: BudgetIncidentWire[]
}

export interface SpendRowAgent { agent: string; costUsdMicros: number | null; runs: number }
export interface SpendRowModel { model: string; costUsdMicros: number | null; runs: number }
export interface SpendRowWorkClass {
  workClass: string
  runs: number
  totalTokens: number | null
  costUsdMicros: number | null
  subscriptionTokens: number
  avgCostUsdMicros: number | null
}
export interface LaneSumsWire {
  meteredUsdMicros: number
  meteredTokens: number
  subscriptionTokens: number
  unpricedMeteredTokens: number
}
export interface ScopeSpendWire extends LaneSumsWire {
  unattributed: { meteredUsdMicros: number; meteredTokens: number; subscriptionTokens: number }
}
export interface WindowSpendWire {
  startMs: number
  global: ScopeSpendWire
  byAgent: Record<string, ScopeSpendWire>
  byProvider: Record<string, LaneSumsWire>
  byModel: Record<string, LaneSumsWire>
}
export interface PaceWire {
  meteredUsdMicros: number | null
  subscriptionTokens: number | null
  endsMs: number
}
export interface SpendTimelineWire {
  startMs: number
  endMs: number
  costUsdMicros: number | null
  subscriptionTokens: number
  unpricedMeteredTokens: number
}
export interface SpendResponse {
  window: string
  estimated: boolean
  totalUsdMicros: number
  byAgent: SpendRowAgent[]
  byModel: SpendRowModel[]
  byWorkClass?: SpendRowWorkClass[]
  timeline?: SpendTimelineWire[]
  facets?: {
    computedAt: number
    observedUsageEvidence?:
      | { status: 'available' }
      | { status: 'unavailable'; reason: 'usage_store_unavailable' }
    daily: WindowSpendWire
    monthly: WindowSpendWire
  }
  pace?: { daily: PaceWire; monthly: PaceWire }
  /** Coverage basis for the pace line: days of this month with a complete sweep (null = receipts unreadable). */
  observedDays?: { month: number | null; daysIntoMonth: number }
}

/** Wire shape of GET /coverage (D27): observed-days coverage + the limit suggestion. */
export type LimitSuggestionWire =
  | { status: 'ready'; monthlyUsd: number; basis: { coveredDays: number; coveredUsdMicros: number; dailyRateUsdMicros: number }; unobservedUsdMicros: number }
  | { status: 'insufficient_history'; coveredDays: number; daysNeeded: number }
  | { status: 'evidence_incomplete'; coveredDays: number }
  | { status: 'no_metered_spend'; coveredDays: number; subscriptionTokens: number }
export interface CoverageWire {
  lookbackDays: number
  computedAt: number
  coveredDays: string[]
  uncoveredDays: string[]
  covered: { window: WindowSpendWire }
  uncovered: { window: WindowSpendWire }
  suggestion: LimitSuggestionWire
}
