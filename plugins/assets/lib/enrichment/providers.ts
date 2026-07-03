/**
 * Vision-enrichment model catalog + default resolution (spec D8).
 *
 * Model ids come from the models plugin's curated catalog
 * (plugins/models/data/known-models.ts) — real ids with real pricing,
 * never fabricated. Capability flags are conservative: `audioInput` is
 * true only where the transport verifiably accepts audio bytes (Gemini
 * inline_data); everything else records `skipped` rather than guessing.
 *
 * Default resolution: cheapest READY vision-capable model (cost tier
 * budget → standard → premium), where READY means the provider has a
 * configured key (env → secret store). `enrichmentModel` overrides
 * exactly; `enrichmentProvider` narrows the pool.
 */
import {
  resolveVisionProviderKeySource,
  type DirectVisionProviderId,
} from '@bakin/core/media'

export type VisionCostTier = 'budget' | 'standard' | 'premium'

export interface VisionModelDescriptor {
  /** Catalog id (plugins/models known-models), e.g. anthropic/claude-haiku-4-5. */
  id: string
  provider: DirectVisionProviderId
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

const TIER_ORDER: Record<VisionCostTier, number> = { budget: 0, standard: 1, premium: 2 }

export interface EnrichmentSettings {
  enrichmentEnabled?: boolean
  enrichmentProvider?: 'auto' | DirectVisionProviderId
  enrichmentModel?: string
}

export interface ResolvedEnrichmentModel {
  descriptor: VisionModelDescriptor
  apiKey: string
  keySource: 'env' | 'store'
}

/**
 * Pick the model for a job. Returns null when nothing capable+configured
 * exists — the caller records `skipped` with the reason, never guesses.
 */
export function resolveEnrichmentModel(
  settings: EnrichmentSettings,
  opts: { needsAudio?: boolean } = {},
): ResolvedEnrichmentModel | null {
  if (settings.enrichmentEnabled === false) return null

  // Exact model override: honor it verbatim (unknown ids still work if the
  // provider prefix is one we can transport to — the user opted in).
  const override = settings.enrichmentModel?.trim()
  if (override) {
    const known = VISION_MODELS.find((m) => m.id === override || m.apiModel === override)
    const descriptor = known ?? inferDescriptor(override)
    if (!descriptor) return null
    if (opts.needsAudio && !descriptor.audioInput) return null
    const key = resolveVisionProviderKeySource(descriptor.provider)
    return key ? { descriptor, apiKey: key.apiKey, keySource: key.source } : null
  }

  const pool = VISION_MODELS
    .filter((m) => settings.enrichmentProvider && settings.enrichmentProvider !== 'auto'
      ? m.provider === settings.enrichmentProvider
      : true)
    .filter((m) => (opts.needsAudio ? m.audioInput : true))
    .sort((a, b) => TIER_ORDER[a.costTier] - TIER_ORDER[b.costTier])

  for (const descriptor of pool) {
    const key = resolveVisionProviderKeySource(descriptor.provider)
    if (key) return { descriptor, apiKey: key.apiKey, keySource: key.source }
  }
  return null
}

function inferDescriptor(modelId: string): VisionModelDescriptor | null {
  const [prefix, ...rest] = modelId.split('/')
  const apiModel = rest.length > 0 ? rest.join('/') : modelId
  if (prefix === 'anthropic' || (rest.length === 0 && modelId.startsWith('claude-'))) {
    return { id: modelId, provider: 'anthropic', apiModel, audioInput: false, costTier: 'standard' }
  }
  if (prefix === 'openai' || (rest.length === 0 && modelId.startsWith('gpt-'))) {
    return { id: modelId, provider: 'openai', apiModel, audioInput: false, costTier: 'standard' }
  }
  if (prefix === 'google' || (rest.length === 0 && modelId.startsWith('gemini-'))) {
    return { id: modelId, provider: 'google', apiModel, audioInput: true, costTier: 'standard' }
  }
  return null
}
