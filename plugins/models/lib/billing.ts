/**
 * Billing-lane detection + provider resolution (cost-control v2, #464).
 *
 * A turn's cost is only honest when we know HOW it bills: an `apiKey` on the
 * provider's auth-profile entry means metered pay-per-token dollars; only
 * OAuth fields (token/access/refresh) means a subscription login — plan
 * quota, where tokens are the unit and a dollar figure would be fiction.
 * Unknown always resolves to 'metered' (conservative: unknown auth reads as
 * real money, never silently uncapped-as-free).
 *
 * Resolution: manual settings override (most specific first: agent+provider
 * → agent → provider) → per-agent detection → 'metered'. Detection reads the
 * runtime-neutral `credentialStatus()` contract (presence-only credential
 * KIND per provider) — credential shapes stay adapter-private, values never
 * cross the boundary.
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import type { BillingLane } from '@bakin/core/execution/ledger'

import type { RuntimeCredentialStatus } from '@bakin/core/adapters/runtime'

import { createLogger } from '../../../src/core/logger'
import { normalizeModelId, providerFromId } from './model-id'
import type { BillingOverride, ModelsPluginSettings } from '../types'

const log = createLogger('models:billing')

export type { BillingLane }
// Single-homed in ../types (the settings shape owns it); re-exported here
// for the detection API surface.
export type { BillingOverride } from '../types'

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

/**
 * Provider id for a model: `provider/model` prefix (after normalization,
 * which maps bare claude-* ids to anthropic); bare unknown ids and missing
 * models bucket under 'other' — never guessed.
 */
export function resolveProviderForModel(modelId: string | null | undefined): string {
  if (!modelId) return 'other'
  const normalized = normalizeModelId(modelId)
  return normalized.includes('/') ? providerFromId(normalized) : 'other'
}

/**
 * How a lane was decided — `override` is operator truth (manual
 * settings.billing.overrides), `detected` came from credential-shape
 * detection, `default` is the conservative metered fallback. Consumers that
 * refuse to trust guessed lanes (the spend engine's observed path, #689)
 * may still trust an explicit override.
 */
export type BillingLaneSource = 'override' | 'detected' | 'default'

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

// Per-agent profile detection cache. Lane flips require re-auth in the
// runtime — rare — so a short TTL keeps dispatch-path reads cheap without
// meaningfully delaying a change.
const CACHE_TTL_MS = 60_000
const laneCache = new Map<string, { at: number; lanes: Record<string, BillingLane> }>()

export function _resetBillingCache(): void {
  laneCache.clear()
}

async function detectedLanesForAgent(ctx: PluginContext, agentId: string): Promise<Record<string, BillingLane>> {
  const cached = laneCache.get(agentId)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.lanes
  let lanes: Record<string, BillingLane> = {}
  try {
    const status = await ctx.runtime.credentialStatus({ agentId })
    lanes = detectLanesFromCredentials(status.llmCredentials)
  } catch (err) {
    // Unknown stays metered — never block or fabricate on a read failure.
    log.warn('Billing-lane detection failed; defaulting to metered', { agentId, err: err instanceof Error ? err.message : String(err) })
  }
  laneCache.set(agentId, { at: Date.now(), lanes })
  return lanes
}

/** Resolve the billing attribution for a (possibly prospective) turn. */
export async function resolveBilling(
  ctx: PluginContext,
  opts: { agentId?: string; model?: string | null },
): Promise<{ provider: string; lane: BillingLane; laneSource: BillingLaneSource }> {
  const provider = resolveProviderForModel(opts.model)
  const overrides = ctx.getSettings<ModelsPluginSettings>().billing?.overrides ?? []
  const detected = opts.agentId ? await detectedLanesForAgent(ctx, opts.agentId) : {}
  const { lane, laneSource } = resolveLaneFor({ provider, agentId: opts.agentId, overrides, detected })
  return { provider, lane, laneSource }
}
