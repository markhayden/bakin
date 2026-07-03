/**
 * Enrichment engine contract + resolution ladder
 * (spec: enrichment-runtime-fallback §1/§4).
 *
 * One interface, two implementations (direct API key / runtime agent
 * turn); the queue, manifest chokepoint, idempotency guard, and retry
 * policy sit ABOVE this seam and never know which engine ran.
 *
 * Ladder (enrichmentProvider):
 *   'auto' (default) → direct key ladder → runtime-if-capable → skip
 *   'anthropic'|'openai'|'google' → that direct provider only
 *   'runtime' → the runtime path only
 * Resolution failures return honest reasons that compose into the
 * manifest's skip record ("<direct reason>; runtime unavailable: <why>").
 */
import type { VisionEnrichmentResult } from '@bakin/core/media'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { resolveEnrichmentModel, DEFAULT_ENRICHMENT_AGENT, type EnrichmentSettings } from './providers'
import { createDirectEngine } from './direct'
import { createRuntimeEngine, runtimeEngineAvailability } from './runtime'

export interface EnrichmentJobInput {
  kind: 'image' | 'audio' | 'document'
  mediaPath?: string
  mediaMime?: string
  extractedText?: string
  existingDescription?: string
  /** Stable job identity (`<assetId>:v<version>`) — the runtime engine's
   *  deterministic thread key, so idempotent replays share a thread. */
  jobKey?: string
}

export interface EnrichmentEngine {
  name: 'direct' | 'runtime'
  /** Identity recorded in the manifest (direct: catalog model id). */
  modelId: string
  run(input: EnrichmentJobInput): Promise<VisionEnrichmentResult>
}

export type EngineResolution =
  | { ok: true; engine: EnrichmentEngine }
  | { ok: false; reason: string }

export interface EngineDeps {
  runtime: AgentRuntimeAdapter | null
}

export async function resolveEnrichmentEngine(
  settings: EnrichmentSettings,
  input: Pick<EnrichmentJobInput, 'kind'>,
  deps: EngineDeps,
): Promise<EngineResolution> {
  if (settings.enrichmentEnabled === false) {
    return { ok: false, reason: 'enrichment disabled in settings' }
  }
  const needsAudio = input.kind === 'audio'
  const provider = settings.enrichmentProvider ?? 'auto'

  const agentId = settings.enrichmentAgent?.trim() || DEFAULT_ENRICHMENT_AGENT

  if (provider === 'runtime') {
    const availability = await runtimeEngineAvailability(deps.runtime, input, { agentId })
    return availability.ok && deps.runtime
      ? { ok: true, engine: createRuntimeEngine(deps.runtime, agentId) }
      : { ok: false, reason: `runtime unavailable: ${availability.ok ? 'no runtime adapter available' : availability.reason}` }
  }

  const direct = resolveEnrichmentModel(settings, { needsAudio })
  if (direct) return { ok: true, engine: createDirectEngine(direct) }

  const directReason = needsAudio
    ? 'no audio-capable enrichment model configured'
    : 'no vision-capable enrichment model configured'

  // A pinned direct provider does NOT fall through to the runtime — the
  // user asked for that provider specifically.
  if (provider !== 'auto') {
    return { ok: false, reason: `${directReason} (provider pinned to ${provider})` }
  }

  const availability = await runtimeEngineAvailability(deps.runtime, input, { agentId })
  if (availability.ok && deps.runtime) {
    return { ok: true, engine: createRuntimeEngine(deps.runtime, agentId) }
  }
  return { ok: false, reason: `${directReason}; runtime unavailable: ${availability.ok ? 'no runtime adapter available' : availability.reason}` }
}
