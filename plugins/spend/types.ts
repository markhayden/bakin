/**
 * Spend plugin — shared types. The wire shapes below are what the spend,
 * policy, incident and billing routes answer with (served by the models
 * plugin until the ownership cutover, T2.7 — then by this plugin).
 */
export type SpendTab = 'overview' | 'limits'
export type SpendWindow = '24h' | '7d' | '30d' | 'all'

/** Wire shape of one budget cap rule (cost-control v2). */
export interface BudgetRuleWire {
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
/** Wire shape of GET /budget/status (full mode). */
export interface BudgetStatusWire {
  paused: boolean
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
}
