/**
 * Direct enrichment engine — the existing key-based vision path wrapped in
 * the engine contract (spec: enrichment-runtime-fallback §4). Same provider
 * transport, same params, same never-fabricate posture.
 *
 * #747 metering rider: every successful billed call writes the same
 * work-class-`enrichment` spend row the runtime engine writes, through the
 * ONE recorder (meterAgentTurn). Direct calls run under no agent, so rows
 * attribute to `system`; provider-reported usage rides verbatim (absent
 * usage records null tokens — never estimated). Failures bill nothing and
 * record nothing.
 */
import { callDirectVisionProvider } from '@bakin/core/media'
import type { MessageResult } from '@bakin/core/adapters/runtime'
import { meterAgentTurn } from '../../../../src/core/agent-cost'
import type { ResolvedEnrichmentModel } from './providers'
import type { EnrichmentEngine, EnrichmentJobInput } from './engine'

export function createDirectEngine(resolved: ResolvedEnrichmentModel): EnrichmentEngine {
  return {
    name: 'direct',
    modelId: resolved.descriptor.id,
    run: async (input: EnrichmentJobInput) => {
      const result = await callDirectVisionProvider({
        provider: resolved.descriptor.provider,
        model: resolved.descriptor.apiModel,
        apiKey: resolved.apiKey,
        kind: input.kind,
        ...(input.mediaPath ? { mediaPath: input.mediaPath, mediaMime: input.mediaMime } : {}),
        ...(input.extractedText ? { extractedText: input.extractedText } : {}),
        ...(input.existingDescription ? { existingDescription: input.existingDescription } : {}),
      })
      const { usage, ...fields } = result
      await meterAgentTurn({
        agent: 'system',
        activityClass: 'system',
        workClass: 'enrichment',
        resolvedModel: resolved.descriptor.id,
        name: 'enrichment',
        // Minimal MessageResult shell — meterAgentTurn only reads id/usage/
        // metadata; there is no runtime turn behind a direct HTTP call.
        result: {
          id: `enrichment:direct:${input.jobKey ?? 'adhoc'}`,
          content: '',
          ...(usage ? { usage: { input: usage.inputTokens, output: usage.outputTokens } } : {}),
        } as unknown as MessageResult,
      })
      return fields
    },
  }
}
