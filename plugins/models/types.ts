import type { RoutingConfig } from '../../src/core/model-routing'
import type { BudgetPolicy } from '../../src/core/budget'

export type { RoutingConfig, BudgetPolicy }

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

export interface AvailableModel {
  id: string
  name: string
  tier: 'budget' | 'standard' | 'premium'
  provider: string
  input?: string
  contextWindow?: number
  local?: boolean
  available?: boolean
  tags?: string[]
  configured?: boolean
  isDefault?: boolean
  fallbackIndex?: number | null
  // ── Enrichment from the curated catalog (plugins/models/data/known-models.ts) ──
  // All optional — unknown models render without them.
  /** Display-ready description shown under the model name. */
  description?: string
  /** Short purpose hint rendered next to the tier badge. */
  bestFor?: string
  /** Display-only cost summary, e.g. '$3 in / $15 out per 1M'. */
  costRange?: string
  /** Display-only context-window string override (e.g. '200K', '1M'). Distinct
   *  from the numeric `contextWindow` which is runtime-sourced. */
  contextWindowDisplay?: string
  /** 'llm' | 'image' | 'video' — gives the UI a reason to cluster differently. */
  kind?: 'llm' | 'image' | 'video'
  /** simple-icons slug for the model's primary brand (usually the provider's). */
  brandIconSlug?: string
  /** Resolved provider metadata — pre-joined server-side so the client doesn't
   *  need a second registry lookup. */
  providerLabel?: string
  providerBrandIconSlug?: string
  providerBrandColor?: string
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
