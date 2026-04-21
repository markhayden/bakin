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
}

export interface AvailableModelsResponse {
  models: AvailableModel[]
  cached: boolean
  cachedAt: number | null
  /** True when cached data is older than the TTL; UI should trigger a background refresh. */
  stale?: boolean
  /** Populated when the live OpenClaw fetch failed AND no cache is available. */
  error?: string
}

export interface AliasesResponse {
  aliases: Record<string, string>
}

export interface ModelCatalogEntry {
  id: string
  name: string
  tier: 'budget' | 'standard' | 'premium'
  bestFor: string
  contextWindow: string
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', tier: 'budget', bestFor: 'Simple tasks, heartbeat, routing', contextWindow: '200K' },
  { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', tier: 'standard', bestFor: 'Content creation, reasoning', contextWindow: '200K' },
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tier: 'standard', bestFor: 'General purpose, current default', contextWindow: '200K' },
  { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', tier: 'premium', bestFor: 'Complex coding, planning, analysis', contextWindow: '200K' },
]

/** Editable task-to-model mapping (stored in plugin settings) */
export interface TaskProfile {
  taskType: string
  recommendedModel: string
  notes: string
}

/** Shape of models plugin settings */
export interface ModelsPluginSettings {
  showUsageMetrics?: boolean
  defaultModel?: string
  taskProfiles?: TaskProfile[]
}
