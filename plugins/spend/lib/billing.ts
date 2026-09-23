/**
 * Billing attribution for turns (cost-control v2, #464): provider from the
 * model id, lane from the operator's overrides in spend.json → per-agent
 * credential-shape detection → metered. The lane rules themselves
 * (`detectLanesFromCredentials`, `resolveLaneFor`) are core-owned in
 * `@bakin/core/llm/billing-lane` so the model plan decides lanes the same
 * way; this module adds the per-agent detection cache and the settings
 * read. Detection reads the runtime-neutral `credentialStatus()` contract
 * (presence-only credential KIND per provider) — credential shapes stay
 * adapter-private, values never cross the boundary.
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import {
  detectLanesFromCredentials,
  resolveLaneFor,
  type BillingLane,
  type BillingLaneSource,
  type BillingOverride,
} from '@bakin/core/llm/billing-lane'

import { createLogger } from '../../../src/core/logger'
import { normalizeModelId, providerFromId } from '@bakin/core/llm/model-id'
import { readOverrides } from './settings'

const log = createLogger('spend:billing')

export { detectLanesFromCredentials, resolveLaneFor }
export type { BillingLane, BillingLaneSource, BillingOverride }

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
  const overrides = readOverrides()
  const detected = opts.agentId ? await detectedLanesForAgent(ctx, opts.agentId) : {}
  const { lane, laneSource } = resolveLaneFor({ provider, agentId: opts.agentId, overrides, detected })
  return { provider, lane, laneSource }
}
