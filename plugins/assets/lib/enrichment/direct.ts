/**
 * Direct enrichment engine — the existing key-based vision path wrapped in
 * the engine contract (spec: enrichment-runtime-fallback §4). ZERO behavior
 * change from the pre-engine call shape: same provider transport, same
 * params, same never-fabricate posture.
 */
import { callDirectVisionProvider } from '@bakin/core/media'
import type { ResolvedEnrichmentModel } from './providers'
import type { EnrichmentEngine, EnrichmentJobInput } from './engine'

export function createDirectEngine(resolved: ResolvedEnrichmentModel): EnrichmentEngine {
  return {
    name: 'direct',
    modelId: resolved.descriptor.id,
    run: (input: EnrichmentJobInput) => callDirectVisionProvider({
      provider: resolved.descriptor.provider,
      model: resolved.descriptor.apiModel,
      apiKey: resolved.apiKey,
      kind: input.kind,
      ...(input.mediaPath ? { mediaPath: input.mediaPath, mediaMime: input.mediaMime } : {}),
      ...(input.extractedText ? { extractedText: input.extractedText } : {}),
      ...(input.existingDescription ? { existingDescription: input.existingDescription } : {}),
    }),
  }
}
