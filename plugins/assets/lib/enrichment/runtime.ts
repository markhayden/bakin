/**
 * Runtime enrichment engine (spec: enrichment-runtime-fallback §4) — a
 * one-shot EPHEMERAL agent turn through ctx.runtime, paying with the
 * runtime's own subscription auth. Bakin never touches runtime
 * credentials; the runtime owns model routing (NEVER send a per-turn
 * model override — the gateway's attachment gate ignores them, bakin#584).
 *
 * Defenses (bakin#583: gateways can silently DROP attachments and models
 * confabulate):
 *   - The prompt carries an anti-confabulation contract — a model that
 *     received no image must reply {"error":"no-image"}, which we treat
 *     as a FAILURE (attachment never arrived), not as content.
 *   - Replies must be pure JSON matching the same Zod schema the direct
 *     engine enforces; one corrective re-ask on the same thread, then
 *     failed. Never fabricated.
 */
import { VisionEnrichmentResultSchema, type VisionEnrichmentResult } from '@bakin/core/media'
import type { AgentRuntimeAdapter, MessageAttachment } from '@bakin/core/adapters/runtime'
import { cleanupPreparedAttachment, prepareImageAttachment, type PreparedAttachment } from '@bakin/core/media/downscale'
import type { EnrichmentEngine, EnrichmentJobInput } from './engine'

export type RuntimeAvailability =
  | { ok: true }
  | { ok: false; reason: string }

/** Median observed agent-turn latency on a live machine (evidence file). */
export const RUNTIME_TURN_ESTIMATED_SECONDS = 35

const MAX_DOCUMENT_CHARS = 6_000

/**
 * Can the runtime path serve this job KIND right now, via THIS agent?
 * Image/audio jobs need the agent's configured model to declare the
 * modality (the adapter probes its own catalog — the same source the
 * gateway gate enforces, so an ok:true here can never be rejected at send
 * time). Document summaries need no media input.
 */
export async function runtimeEngineAvailability(
  runtime: AgentRuntimeAdapter | null,
  input: Pick<EnrichmentJobInput, 'kind'>,
  opts: { agentId?: string } = {},
): Promise<RuntimeAvailability> {
  if (!runtime) return { ok: false, reason: 'no runtime adapter available' }
  if (!runtime.capabilities) return { ok: false, reason: 'runtime does not report input capabilities' }
  if (input.kind !== 'document') {
    let caps: Awaited<ReturnType<NonNullable<AgentRuntimeAdapter['capabilities']>>> | null = null
    try {
      caps = await runtime.capabilities(opts.agentId ? { agentId: opts.agentId } : undefined)
    } catch {
      caps = null
    }
    if (!caps) return { ok: false, reason: 'runtime capability probe failed' }
    const agentLabel = opts.agentId ? `agent '${opts.agentId}'` : 'runtime model'
    if (input.kind === 'image' && !caps.input.imageInput) {
      return { ok: false, reason: `${agentLabel} has no image input` }
    }
    if (input.kind === 'audio' && !caps.input.audioInput) {
      return { ok: false, reason: `${agentLabel} has no audio input` }
    }
  }
  return { ok: true }
}

const NO_IMAGE_SENTINEL = 'no-image'
const CORRECTIVE_REASK = 'Reply with only the JSON object, nothing else — no prose, no code fences.'

function buildPrompt(input: EnrichmentJobInput): string {
  const discipline = 'Reply with ONLY a JSON object — no prose, no markdown, no code fences.'
  if (input.kind === 'image') {
    return [
      'You are enriching an image asset for search indexing. Look at the attached image.',
      discipline,
      'Shape: {"caption": string (one factual sentence describing exactly what is visible), "ocrText": string (all readable text in the image transcribed verbatim; "" when none), "suggestedTags": string[] (3-8 lowercase, hyphenated, concrete tags)}',
      `If no image is visible to you, reply exactly: {"error":"${NO_IMAGE_SENTINEL}"}`,
      ...(input.existingDescription ? [`Context (existing description, may be wrong): ${input.existingDescription}`] : []),
    ].join('\n')
  }
  if (input.kind === 'audio') {
    return [
      'You are enriching an audio asset for search indexing. Listen to the attached audio.',
      discipline,
      'Shape: {"transcript": string (verbatim transcription; "" when unintelligible), "caption": string (one sentence describing the audio), "suggestedTags": string[] (3-8 lowercase, hyphenated, concrete tags)}',
      `If no audio is available to you, reply exactly: {"error":"${NO_IMAGE_SENTINEL}"}`,
    ].join('\n')
  }
  const text = (input.extractedText ?? '').slice(0, MAX_DOCUMENT_CHARS)
  return [
    'You are enriching a text document for search indexing. The document content follows after the shape.',
    discipline,
    'Shape: {"summary": string (2-3 factual sentences), "suggestedTags": string[] (3-8 lowercase, hyphenated, concrete tags)}',
    '--- DOCUMENT ---',
    text,
  ].join('\n')
}

/** Strip a single fenced block if the model wrapped its JSON anyway. */
function stripFences(reply: string): string {
  const trimmed = reply.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(trimmed)
  return (fence ? fence[1] : trimmed).trim()
}

type ParseOutcome =
  | { ok: true; result: VisionEnrichmentResult }
  | { ok: false; reason: string; noImage?: boolean }

function parseReply(reply: string | undefined): ParseOutcome {
  if (!reply || reply.trim().length === 0) return { ok: false, reason: 'empty reply from runtime agent' }
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(reply))
  } catch {
    return { ok: false, reason: `runtime agent reply was not valid JSON: ${reply.slice(0, 120)}` }
  }
  if (parsed && typeof parsed === 'object' && (parsed as { error?: unknown }).error === NO_IMAGE_SENTINEL) {
    return { ok: false, noImage: true, reason: 'attachment did not reach the model — see bakin#583' }
  }
  const result = VisionEnrichmentResultSchema.safeParse(parsed)
  if (!result.success) {
    return { ok: false, reason: `runtime agent reply failed schema validation: ${result.error.issues[0]?.message ?? 'invalid shape'}` }
  }
  return { ok: true, result: result.data }
}

/**
 * One-shot ephemeral turn: fresh deterministic thread per asset+version
 * (idempotent replays land on the same thread; ephemeral keeps it out of
 * the agent's visible session history). One corrective re-ask on parse
 * failure, then failed — never fabricated.
 */
export function createRuntimeEngine(runtime: AgentRuntimeAdapter, agentId: string): EnrichmentEngine {
  return {
    name: 'runtime',
    modelId: `runtime:${agentId}`,
    async run(input: EnrichmentJobInput): Promise<VisionEnrichmentResult> {
      const threadId = `enrich:${input.jobKey ?? 'adhoc'}`
      let attachments: MessageAttachment[] | undefined
      let prepared: PreparedAttachment | null = null
      if (input.kind !== 'document' && input.mediaPath) {
        // Oversized images are downscaled to a temp JPEG BEFORE the send —
        // the gateway's 2MB inline cap otherwise silently degrades them
        // and the model never sees pixels (bakin#583 territory).
        prepared = input.kind === 'image'
          ? await prepareImageAttachment(input.mediaPath, input.mediaMime ?? 'application/octet-stream')
          : { path: input.mediaPath, mimeType: input.mediaMime ?? 'application/octet-stream', downscaled: false }
        attachments = [{ path: prepared.path, mimeType: prepared.mimeType }]
      }

      // Work-class route ('enrichment') — DOCUMENT jobs only: attachment
      // turns must stay override-free (the gateway's attachment gate ignores
      // per-turn models, bakin#584 — the header contract above). Metering
      // applies to every send regardless.
      const { resolveSystemRoute, routeSendArgs } = await import('../../../../src/core/system-route')
      const { meterAgentTurn } = await import('../../../../src/core/agent-cost')
      const route = input.kind === 'document' && !attachments
        ? await resolveSystemRoute('enrichment')
        : { source: 'inherit' as const }

      const send = async (content: string) => {
        const result = await runtime.messaging.send({
          agentId,
          activityClass: 'system',
          content,
          threadId,
          ephemeral: true,
          ...(attachments ? { attachments } : {}),
          ...routeSendArgs(route),
        })
        await meterAgentTurn({
          agent: agentId,
          activityClass: 'system',
          workClass: 'enrichment',
          routeSource: route.source,
          resolvedModel: route.model,
          result,
          name: 'enrichment',
        })
        return result
      }

      try {
        const first = await send(buildPrompt(input))
        let outcome = parseReply(first.content)
        if (outcome.ok) return outcome.result
        if (outcome.noImage) throw new Error(outcome.reason)

        // ONE corrective re-ask on the same thread, then honest failure.
        const second = await send(CORRECTIVE_REASK)
        outcome = parseReply(second.content)
        if (outcome.ok) return outcome.result
        throw new Error(outcome.reason)
      } finally {
        // The re-ask reuses the downscaled file, so cleanup happens only
        // after the LAST send — including every throw path above.
        if (prepared) cleanupPreparedAttachment(prepared)
      }
    },
  }
}
