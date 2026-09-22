/**
 * Available-models cache + fetch + catalog merge.
 *
 * Extracted from index.ts. Three cache tiers front the runtime's model list:
 * the in-memory hot cache (globalThis-backed, owned by THIS module only), the
 * persisted disk cache (`./models-cache` — ~/.bakin/plugin-settings/models/
 * available.json), and the live runtime fetch with in-flight promise dedupe.
 * `loadConfiguredModelsFromRuntime` merges the curated known-models catalog
 * (plugins/models/data/known-models.ts) into each runtime model — enrichment
 * only, never fabricated metadata: unknown models get none of the catalog
 * fields and render plain in the UI.
 */
import type { PluginContext } from '@bakin/core/plugin-types'

import type { AvailableModel } from '../types'
import { getModelEligibility } from '../../../src/core/model-eligibility'
import { enumerateSelections } from '../../../src/core/model-selections'
import { createLogger } from '../../../src/core/logger'
import { readRoutingSettings } from './selections'
import {
  clearPersistedCache,
  readPersistedCache,
  writePersistedCache,
} from './models-cache'
import { getKnownModel, getKnownProvider, formatCostRange } from '../data/known-models'
import { normalizeModelId, providerFromId, tierFromId } from './model-id'

// ---------------------------------------------------------------------------
// Available models cache (globalThis-backed so every reach into this module
// shares one cache instance)
// ---------------------------------------------------------------------------
interface ModelsCache { models: AvailableModel[]; fetchedAt: number }
const mc = globalThis as typeof globalThis & { __bakinModelsCache?: ModelsCache | null }
if (!mc.__bakinModelsCache) mc.__bakinModelsCache = null
export function getModelsCache(): ModelsCache | null { return mc.__bakinModelsCache ?? null }
export function setModelsCache(cache: ModelsCache | null) { mc.__bakinModelsCache = cache }
const CACHE_TTL = 60 * 60 * 1000 // 1 hour
const log = createLogger('models:available')

function sortModels(a: AvailableModel, b: AvailableModel): number {
  if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
  if ((a.isDefault ? 1 : 0) !== (b.isDefault ? 1 : 0)) return a.isDefault ? -1 : 1
  if ((a.fallbackIndex ?? 999) !== (b.fallbackIndex ?? 999)) return (a.fallbackIndex ?? 999) - (b.fallbackIndex ?? 999)
  if ((a.configured ? 1 : 0) !== (b.configured ? 1 : 0)) return a.configured ? -1 : 1
  return a.name.localeCompare(b.name)
}

export async function loadConfiguredModelsFromRuntime(ctx: PluginContext): Promise<AvailableModel[]> {
  // includeUnavailable: an auth-less model must stay LISTED (disabled, with
  // its reason) so a picker can show why a persisted selection is dead
  // instead of the row silently vanishing (#907).
  const runtimeModels = await ctx.runtime.models.listAvailable({ includeUnavailable: true })
  const policy = await ctx.runtime.models.routingPolicy()
  const defaultModel = normalizeModelId(policy.defaultModel)
  const fallbackModels = policy.fallbackModels.map(normalizeModelId)

  return runtimeModels
    .filter((model) => Boolean(model.id))
    .map((model) => {
      const id = normalizeModelId(model.id)
      const tags = model.tags ?? []
      const fallbackIndex = fallbackModels.indexOf(id)
      const provider = providerFromId(id)
      const known = getKnownModel(id)
      const knownProvider = getKnownProvider(provider)
      return {
        id,
        name: known?.name ?? model.name ?? id,
        tier: known?.tier ?? tierFromId(id),
        provider,
        input: model.input,
        contextWindow: model.contextWindow,
        local: model.local,
        available: model.available ?? true,
        ...(model.unavailableReason ? { unavailableReason: model.unavailableReason } : {}),
        tags,
        configured: tags.includes('configured'),
        isDefault: id === defaultModel,
        fallbackIndex: fallbackIndex >= 0 ? fallbackIndex : null,
        // Enrichment from the curated catalog (plugins/models/data/known-models.ts).
        // Unknown models get none of these and render plain in the UI.
        description: known?.description,
        bestFor: known?.bestFor,
        // Display cost: literal for non-token-priced models, derived from
        // structured pricing for LLMs. Unknown models get neither.
        costRange: known?.costRange ?? (known?.pricing ? formatCostRange(known.pricing) : undefined),
        contextWindowDisplay: known?.contextWindow,
        kind: known?.kind,
        brandIconSlug: known?.brandIconSlug,
        providerLabel: knownProvider?.label,
        providerBrandIconSlug: knownProvider?.brandIconSlug,
        providerBrandColor: knownProvider?.brandColor,
      }
    })
    .sort(sortModels)
}

export interface FetchResult {
  models: AvailableModel[]
  cached: boolean
  cachedAt: number | null
  stale: boolean
  error?: string
}

// In-flight promise dedupe — two concurrent /available requests on a
// cold-cold start would otherwise both ask the runtime for its complete
// model list, which can be slow. With this, the second caller awaits
// the first's result.
let inflightFetch: Promise<FetchResult> | null = null
let lastRuntimeModelFetchWarning: { message: string; at: number } | null = null

// Runtime epoch (#907, D29): bumped whenever the runtime behind the catalog
// changes (a switch). A fetch captures the epoch when it starts and PUBLISHES
// to the hot/disk caches only if it is unchanged when it completes — nulling
// `inflightFetch` alone would let the old promise repopulate the caches with
// the previous runtime's models.
let catalogEpoch = 0
export function currentCatalogEpoch(): number { return catalogEpoch }

/** Drop every catalog cache layer and invalidate any fetch still in flight. */
export function resetModelsCache(): void {
  catalogEpoch++
  setModelsCache(null)
  clearPersistedCache()
  inflightFetch = null
}
const MODEL_FETCH_WARNING_TTL = 60_000

function warnRuntimeModelFetchFailed(message: string): void {
  const now = Date.now()
  if (
    lastRuntimeModelFetchWarning &&
    lastRuntimeModelFetchWarning.message === message && // arch:allow-error-message log-dedupe equality, not classification
    now - lastRuntimeModelFetchWarning.at < MODEL_FETCH_WARNING_TTL
  ) {
    return
  }
  lastRuntimeModelFetchWarning = { message, at: now }
  console.warn(`Failed to fetch models from runtime: ${message}`)
}

/**
 * Recompute catalog-derived enrichment on cache-served rows. Tier (and its
 * heuristic) is code, not runtime data — a persisted cache written by an
 * older heuristic/catalog must never pin stale labels (live incident: the
 * cheap-route recommender saw gpt-5.4-mini as 'premium' from a pre-fix
 * cache until a manual refresh).
 */
function withFreshTiers(models: AvailableModel[]): AvailableModel[] {
  return models.map((m) => ({ ...m, tier: getKnownModel(m.id)?.tier ?? tierFromId(m.id) }))
}

let lastOverlayWarning = 0
const OVERLAY_WARNING_TTL = 60_000

/**
 * Overlay ELIGIBILITY (#907; subsumes the #852 rejection overlay) on every
 * read — same posture as withFreshTiers: ledger + credential state is
 * code-external truth the cache must never pin, in either direction. Flip,
 * not filter: a row stays listed with `available: false` + the verdict so
 * pickers can disable it WITH the reason. The cached rows are the catalog
 * snapshot the engine folds over (no second runtime round-trip); missing
 * evidence reads `unknown` (FAIL OPEN — a DB glitch must not starve routing).
 */
export async function applyEligibilityOverlay(ctx: PluginContext, models: AvailableModel[]): Promise<AvailableModel[]> {
  const report = await getModelEligibility(ctx.runtime, {
    catalog: models.map((m) => ({
      id: m.id,
      available: m.available,
      ...(m.unavailableReason ? { unavailableReason: m.unavailableReason } : {}),
      ...(m.local ? { local: true } : {}),
    })),
  })
  // Runtime-unavailable rows are kept ONLY when a persisted selection points
  // at them: a dead pin must stay visible (disabled, with its reason) in the
  // picker that holds it, but Pi's full catalog has ~1,300 auth-less models
  // that nobody selected — listing them would bury the ones that matter.
  const referenced = await referencedModelIds(ctx)
  if (report.evidence.rejections === 'failed') {
    const now = Date.now()
    if (now - lastOverlayWarning >= OVERLAY_WARNING_TTL) {
      lastOverlayWarning = now
      console.warn('Model-rejection overlay skipped (ledger unavailable?): rejection evidence failed')
    }
  }
  return models
    .filter((m) => m.available !== false || referenced.has(m.id))
    .map((m) => {
      const entry = report.byModel.get(m.id)
      if (!entry) return m
      const { eligibility, rejection } = entry
      return {
        ...m,
        available: eligibility.status !== 'ineligible' && m.available !== false,
        eligibility,
        ...(rejection ? { rejection: { lastSeenAt: rejection.lastSeenAt, occurrences: rejection.occurrences } } : {}),
      }
    })
}

/** Model ids any persisted selection (policy, roster, routes, tags) points at. Empty on read failure — never blocks a listing. */
async function referencedModelIds(ctx: PluginContext): Promise<Set<string>> {
  try {
    const { routing } = readRoutingSettings(ctx)
    const states = await enumerateSelections(ctx.runtime, { routing })
    return new Set(states.filter((s) => s.ref !== 'ui:mode').map((s) => s.model).filter((m): m is string => typeof m === 'string' && m.length > 0))
  } catch (err) {
    log.debug('referenced-model read failed; listing available rows only', { error: String(err) })
    return new Set()
  }
}

export async function fetchAvailableModels(ctx: PluginContext, opts?: { force?: boolean }): Promise<FetchResult> {
  // force: skip both caches and fetch live — the repair path for stale/
  // missing pricing (a health repair must refresh deterministically, not
  // depend on a human visiting the Models page to trigger it).
  if (!opts?.force) {
    // 1. Hot read — in-memory cache (fresh by TTL)
    const memCached = getModelsCache()
    if (memCached && Date.now() - memCached.fetchedAt < CACHE_TTL) {
      return { models: await applyEligibilityOverlay(ctx, withFreshTiers(memCached.models)), cached: true, cachedAt: memCached.fetchedAt, stale: false }
    }

    // 2. Persistent cache hydration — survives server restart even when
    //    in-memory is empty. Always returns last-known-good; `stale` tells
    //    the client whether to kick off a background refresh.
    const diskCached = memCached ? null : readPersistedCache()
    if (diskCached) {
      setModelsCache({ models: diskCached.models, fetchedAt: diskCached.fetchedAt })
      const stale = Date.now() - diskCached.fetchedAt >= CACHE_TTL
      return { models: await applyEligibilityOverlay(ctx, withFreshTiers(diskCached.models)), cached: true, cachedAt: diskCached.fetchedAt, stale }
    }
  }

  // 3. No cache → live fetch. Dedupe concurrent callers against one
  //    in-flight promise. On success: write both caches. On failure:
  //    honest empty state — no fake data.
  if (inflightFetch) return inflightFetch
  const startedEpoch = catalogEpoch
  let self: Promise<FetchResult> | null = null
  const fetch = (async (): Promise<FetchResult> => {
    try {
      const models = await loadConfiguredModelsFromRuntime(ctx as unknown as PluginContext)
      const now = Date.now()
      if (catalogEpoch !== startedEpoch) {
        // The runtime changed underneath this fetch: serve nothing stale and
        // publish nothing — the next caller fetches from the new runtime.
        return { models: [], cached: false, cachedAt: null, stale: true, error: 'runtime changed during fetch' }
      }
      // Caches persist the RAW runtime snapshot; only the response is
      // overlaid — rejection truth lives in the ledger alone.
      setModelsCache({ models, fetchedAt: now })
      writePersistedCache({ models, fetchedAt: now, source: 'runtime' })
      return { models: await applyEligibilityOverlay(ctx, models), cached: false, cachedAt: now, stale: false }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      warnRuntimeModelFetchFailed(message)
      return { models: [], cached: false, cachedAt: null, stale: false, error: message }
    } finally {
      if (inflightFetch === self) inflightFetch = null
    }
  })()
  self = fetch
  inflightFetch = fetch
  return fetch
}
