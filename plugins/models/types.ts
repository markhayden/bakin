import type { RoutingConfig } from '../../src/core/model-routing'
// AvailableModel is single-homed in the SDK (the wire shape this plugin's
// /available route produces and the team plugin consumes).
import type { AvailableModel } from '@makinbakin/sdk/types'

export type { RoutingConfig, AvailableModel }

export interface AgentModelConfig {
  agentId: string
  name: string
  emoji: string
  ownModel: string | null
  subagentModel: string | null
  defaultModel: string
  defaultSubagentModel: string | null
  /** Resolved effective model (ownModel ?? defaultModel) */
  effectiveModel: string
}

export interface ModelsConfigResponse {
  agents: AgentModelConfig[]
  defaultModel: string
  defaultSubagentModel: string | null
  fallbackModels: string[]
  /** Which routing knobs the ACTIVE runtime honors — UIs hide the rest. */
  support?: {
    defaultModel: boolean
    fallbackModels: boolean
    defaultSubagentModel: boolean
    aliases: boolean
    perAgentSubagentModel: boolean
    supportedThinkingLevels: string[]
  }
}


export interface AvailableModelsResponse {
  models: AvailableModel[]
  cached: boolean
  cachedAt: number | null
  /** True when cached data is older than the TTL; UI should trigger a background refresh. */
  stale?: boolean
  /** Populated when the live runtime fetch failed AND no cache is available. */
  error?: string
}

export interface AliasesResponse {
  aliases: Record<string, string>
}

/** Shape of models plugin settings */
export interface ModelsPluginSettings {
  defaultModel?: string
  /** Models page presentation mode (#907, D4). A VIEW preference — never changes configuration. */
  ui?: { mode?: 'simple' | 'advanced' }
  /** Per-turn model/thinking routing policy (work classes + tag overrides). */
  routing?: RoutingConfig
}

// ---------------------------------------------------------------------------
// Selections + plan wire shapes (the page's two reads, #907 / spec §3.4)
// ---------------------------------------------------------------------------
export type SelectionEligibilityWire =
  | { status: 'eligible'; detail: string }
  | { status: 'ineligible'; reason: 'not_in_catalog' | 'runtime_unavailable' | 'no_credentials' | 'account_rejected'; detail: string }
  | { status: 'unknown'; detail: string }

/** One persisted selection (`GET /selections` row). */
export interface SelectionStateWire {
  ref: string
  model: string | null
  thinking?: string
  document: string
  label: string
  eligibility?: SelectionEligibilityWire
}

export interface SelectionProposalWire {
  ref: string
  from: string
  to: string | null
  reason: string
  source: 'same-id-credentialed-provider' | 'recommender' | 'none'
  revision: string
}

export interface PendingWriteWire {
  document: string
  refs: string[]
  intended: Record<string, string | null>
  state: 'unsettled' | 'failed' | 'conflict'
  detail?: string
  startedAt: number
}

export interface RoutingSupportWire {
  defaultModel: boolean
  fallbackModels: boolean
  defaultSubagentModel: boolean
  aliases: boolean
  perAgentSubagentModel: boolean
  supportedThinkingLevels: string[]
  perTurnModel?: boolean
}

export interface SelectionsResponse {
  revision: string
  support: RoutingSupportWire
  states: SelectionStateWire[]
  proposals: SelectionProposalWire[]
  pending: PendingWriteWire[]
  evidence: { catalog: 'ok' | 'partial' | 'failed'; runtimeAvailability: 'ok' | 'partial' | 'failed'; credentials: 'ok' | 'partial' | 'failed'; rejections: 'ok' | 'partial' | 'failed' }
}

export interface SelectionOpWire {
  ref: string
  set: { model?: string | null; thinking?: string | null }
}

export interface PlanLaneWire {
  model: string | null
  why: string
  suitability: 'known' | 'unknown' | 'none'
}

export interface PlanResponse {
  revision: string
  current: {
    agent: string | null
    chores: { model: string | null; models: string[]; mixed: boolean }
    enrichmentEnabled: boolean
  }
  recommended: {
    agent: PlanLaneWire
    chores: PlanLaneWire
    routes: Array<{ workClass: string; model: string | null; reason: string }>
    enrichment: 'chores' | 'agent' | 'unset' | 'disabled'
    ops: SelectionOpWire[]
    notes: string[]
  }
  routeProposals: {
    proposals: Array<{ workClass: string; model: string; reason: string }>
    skipped: Array<{ workClass: string; reason: string }>
  }
  candidates: number
}
