import type { RoutingConfig } from '../../src/core/model-routing'
import type { BudgetPolicy } from '../../src/core/budget'
// AvailableModel is single-homed in the SDK (the wire shape this plugin's
// /available route produces and the team plugin consumes).
import type { AvailableModel } from '@makinbakin/sdk/types'

export type { RoutingConfig, BudgetPolicy, AvailableModel }

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
  /** Per-turn model/thinking routing policy (origins + tag overrides). */
  routing?: RoutingConfig
  /** Spend-cap policy (global + per-agent daily/monthly limits). */
  budget?: BudgetPolicy
}
