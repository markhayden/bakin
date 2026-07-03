/**
 * Runtime enrichment engine (spec: enrichment-runtime-fallback §4) — a
 * one-shot agent turn through ctx.runtime, paying with the runtime's own
 * subscription auth. P1 ships the AVAILABILITY probe (capability-gated,
 * honest reasons); the engine itself lands in P2 behind it.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import type { EnrichmentJobInput } from './engine'

export type RuntimeAvailability =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Can the runtime path serve this job KIND right now? Image/audio jobs
 * need the runtime's model to declare the modality (the adapter probes
 * its own catalog — the same source the gateway gate enforces, so an
 * ok:true here can never be rejected at send time). Document summaries
 * need no media input.
 */
export async function runtimeEngineAvailability(
  runtime: AgentRuntimeAdapter | null,
  input: Pick<EnrichmentJobInput, 'kind'>,
): Promise<RuntimeAvailability> {
  if (!runtime) return { ok: false, reason: 'no runtime adapter available' }
  if (!runtime.capabilities) return { ok: false, reason: 'runtime does not report input capabilities' }
  let caps: Awaited<ReturnType<NonNullable<AgentRuntimeAdapter['capabilities']>>> | null = null
  try {
    caps = await runtime.capabilities()
  } catch {
    caps = null
  }
  if (!caps) return { ok: false, reason: 'runtime capability probe failed' }
  if (input.kind === 'image' && !caps.imageInput) {
    return { ok: false, reason: 'runtime model has no image input' }
  }
  if (input.kind === 'audio' && !caps.audioInput) {
    return { ok: false, reason: 'runtime model has no audio input' }
  }
  // Capability satisfied — the turn engine itself is Phase P2.
  return { ok: false, reason: 'runtime enrichment engine not yet implemented (P2)' }
}
