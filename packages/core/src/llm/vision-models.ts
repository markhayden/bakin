/**
 * Vision-capable model catalog — the ONE authoritative list of models whose
 * transports verifiably accept image (and optionally audio) bytes. Shared by
 * the assets plugin's enrichment engine (direct-provider selection) and the
 * models plugin's cheap-vision route recommendations. Model ids come from
 * the curated catalog (plugins/models/data/known-models.ts) — real ids with
 * real pricing, never fabricated; capability flags are conservative.
 */
import type { DirectProviderId } from './provider-keys'

export type VisionCostTier = 'budget' | 'standard' | 'premium'

export interface VisionModelDescriptor {
  /** Catalog id (plugins/models known-models), e.g. anthropic/claude-haiku-4-5. */
  id: string
  provider: DirectProviderId
  /** Provider-native model id (catalog prefix stripped). */
  apiModel: string
  audioInput: boolean
  costTier: VisionCostTier
}

export const VISION_MODELS: VisionModelDescriptor[] = [
  { id: 'anthropic/claude-haiku-4-5', provider: 'anthropic', apiModel: 'claude-haiku-4-5', audioInput: false, costTier: 'budget' },
  { id: 'google/gemini-2.5-flash', provider: 'google', apiModel: 'gemini-2.5-flash', audioInput: true, costTier: 'budget' },
  { id: 'anthropic/claude-sonnet-4-6', provider: 'anthropic', apiModel: 'claude-sonnet-4-6', audioInput: false, costTier: 'standard' },
  { id: 'openai/gpt-4o', provider: 'openai', apiModel: 'gpt-4o', audioInput: false, costTier: 'standard' },
  { id: 'google/gemini-2.5-pro', provider: 'google', apiModel: 'gemini-2.5-pro', audioInput: true, costTier: 'premium' },
]
