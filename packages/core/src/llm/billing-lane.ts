/**
 * Billing-lane vocabulary + the two PURE lane rules, core-owned so the
 * spend plugin (turn pricing, `spend.resolveBilling`) and the model plan
 * (`src/core/model-plan-input.ts`, which onboarding runs without plugins)
 * decide lanes the same way.
 *
 * An `apiKey` credential means metered pay-per-token dollars; an OAuth
 * login means a subscription — plan quota, where tokens are the unit and a
 * dollar figure would be fiction. Unknown always resolves to 'metered'
 * (conservative: unknown auth reads as real money, never silently free).
 */
import type { RuntimeCredentialStatus } from '../adapters/runtime'
import type { BillingLane } from '../execution/ledger'

export type { BillingLane }

/** An operator-set lane for an agent, a provider, or the pair. */
export interface BillingOverride {
  agentId?: string
  provider?: string
  lane: BillingLane
}

/**
 * How a lane was decided — `override` is operator truth, `detected` came
 * from credential-shape detection, `default` is the conservative metered
 * fallback. Consumers that refuse to trust guessed lanes may still trust
 * an explicit override.
 */
export type BillingLaneSource = 'override' | 'detected' | 'default'

/**
 * Provider → lane map from the runtime's presence-only credential report.
 * 'api-key' bills metered; 'oauth' is a subscription login. First entry per
 * provider wins (the adapters already dedupe).
 */
export function detectLanesFromCredentials(
  credentials: RuntimeCredentialStatus['llmCredentials'],
): Record<string, BillingLane> {
  const lanes: Record<string, BillingLane> = {}
  for (const entry of credentials ?? []) {
    if (lanes[entry.provider]) continue
    lanes[entry.provider] = entry.kind === 'oauth' ? 'subscription' : 'metered'
  }
  return lanes
}

/** Pure lane resolution: overrides (most specific first) → detection → metered. */
export function resolveLaneFor(input: {
  provider: string
  agentId?: string
  overrides: BillingOverride[]
  detected: Partial<Record<string, BillingLane>>
}): { lane: BillingLane; laneSource: BillingLaneSource } {
  const { provider, agentId, overrides, detected } = input
  const match = (pred: (o: BillingOverride) => boolean) => overrides.find(pred)?.lane
  const overridden =
    (agentId !== undefined ? match((o) => o.agentId === agentId && o.provider === provider) : undefined) ??
    (agentId !== undefined ? match((o) => o.agentId === agentId && o.provider === undefined) : undefined) ??
    match((o) => o.agentId === undefined && o.provider === provider)
  if (overridden !== undefined) return { lane: overridden, laneSource: 'override' }
  const detectedLane = detected[provider]
  if (detectedLane !== undefined) return { lane: detectedLane, laneSource: 'detected' }
  return { lane: 'metered', laneSource: 'default' }
}
