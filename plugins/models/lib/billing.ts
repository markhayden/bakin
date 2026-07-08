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
 * → agent → provider) → per-agent profile detection → 'metered'. Profile
 * reads go through the allowlisted raw-config gate and only inspect
 * credential SHAPE — values never leave this module.
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import type { BillingLane } from '@bakin/core/execution/ledger'

import { createLogger } from '../../../src/core/logger'
import { readAllowedRuntimeConfigRaw } from '../../../src/core/runtime-config-raw'
import {
  METERED_CREDENTIAL_FIELDS,
  SUBSCRIPTION_CREDENTIAL_FIELDS,
  authProfileEntryHasField,
  authProfileEntryProvider,
  normalizeAuthProfileEntries,
} from '../../../src/core/runtime-auth-profiles'
import { normalizeModelId, providerFromId } from './model-id'
import type { BillingOverride, ModelsPluginSettings } from '../types'

const log = createLogger('models:billing')

export type { BillingLane }
// Single-homed in ../types (the settings shape owns it); re-exported here
// for the detection API surface.
export type { BillingOverride } from '../types'

/** Provider → lane map detected from one agent's auth profiles. */
export function detectLanesFromProfiles(parsed: unknown): Record<string, BillingLane> {
  const lanes: Record<string, BillingLane> = {}
  for (const entry of normalizeAuthProfileEntries(parsed)) {
    const provider = authProfileEntryProvider(entry)
    if (!provider || lanes[provider]) continue
    if (authProfileEntryHasField(entry, METERED_CREDENTIAL_FIELDS)) {
      lanes[provider] = 'metered'
    } else if (authProfileEntryHasField(entry, SUBSCRIPTION_CREDENTIAL_FIELDS)) {
      lanes[provider] = 'subscription'
    }
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

/** Pure lane resolution: overrides (most specific first) → detection → metered. */
export function resolveLaneFor(input: {
  provider: string
  agentId?: string
  overrides: BillingOverride[]
  detected: Partial<Record<string, BillingLane>>
}): BillingLane {
  const { provider, agentId, overrides, detected } = input
  const match = (pred: (o: BillingOverride) => boolean) => overrides.find(pred)?.lane
  const overridden =
    (agentId !== undefined ? match((o) => o.agentId === agentId && o.provider === provider) : undefined) ??
    (agentId !== undefined ? match((o) => o.agentId === agentId && o.provider === undefined) : undefined) ??
    match((o) => o.agentId === undefined && o.provider === provider)
  return overridden ?? detected[provider] ?? 'metered'
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
    const parsed = await readAllowedRuntimeConfigRaw<unknown>(
      ctx.runtime,
      `agents.${agentId}.authProfiles`,
      'models.billing-lane',
    )
    lanes = detectLanesFromProfiles(parsed)
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
): Promise<{ provider: string; lane: BillingLane }> {
  const provider = resolveProviderForModel(opts.model)
  const overrides = ctx.getSettings<ModelsPluginSettings>().billing?.overrides ?? []
  const detected = opts.agentId ? await detectedLanesForAgent(ctx, opts.agentId) : {}
  return { provider, lane: resolveLaneFor({ provider, agentId: opts.agentId, overrides, detected }) }
}
