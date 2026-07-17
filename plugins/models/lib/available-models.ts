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
import {
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

function sortModels(a: AvailableModel, b: AvailableModel): number {
  if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
  if ((a.isDefault ? 1 : 0) !== (b.isDefault ? 1 : 0)) return a.isDefault ? -1 : 1
  if ((a.fallbackIndex ?? 999) !== (b.fallbackIndex ?? 999)) return (a.fallbackIndex ?? 999) - (b.fallbackIndex ?? 999)
  if ((a.configured ? 1 : 0) !== (b.configured ? 1 : 0)) return a.configured ? -1 : 1
  return a.name.localeCompare(b.name)
}

export async function loadConfiguredModelsFromRuntime(ctx: PluginContext): Promise<AvailableModel[]> {
  const runtimeModels = await ctx.runtime.models.listAvailable()
  const policy = await ctx.runtime.models.routingPolicy()
  const defaultModel = normalizeModelId(policy.defaultModel)
  const fallbackModels = policy.fallbackModels.map(normalizeModelId)

  return runtimeModels
    .filter((model) => model.id && model.available !== false)
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

export async function fetchAvailableModels(ctx: PluginContext): Promise<FetchResult> {
  // 1. Hot read — in-memory cache (fresh by TTL)
  const memCached = getModelsCache()
  if (memCached && Date.now() - memCached.fetchedAt < CACHE_TTL) {
    return { models: withFreshTiers(memCached.models), cached: true, cachedAt: memCached.fetchedAt, stale: false }
  }

  // 2. Persistent cache hydration — survives server restart even when
  //    in-memory is empty. Always returns last-known-good; `stale` tells
  //    the client whether to kick off a background refresh.
  const diskCached = memCached ? null : readPersistedCache()
  if (diskCached) {
    setModelsCache({ models: diskCached.models, fetchedAt: diskCached.fetchedAt })
    const stale = Date.now() - diskCached.fetchedAt >= CACHE_TTL
    return { models: withFreshTiers(diskCached.models), cached: true, cachedAt: diskCached.fetchedAt, stale }
  }

  // 3. No cache → live fetch. Dedupe concurrent callers against one
  //    in-flight promise. On success: write both caches. On failure:
  //    honest empty state — no fake data.
  if (inflightFetch) return inflightFetch
  inflightFetch = (async (): Promise<FetchResult> => {
    try {
      const models = await loadConfiguredModelsFromRuntime(ctx as unknown as PluginContext)
      const now = Date.now()
      setModelsCache({ models, fetchedAt: now })
      writePersistedCache({ models, fetchedAt: now, source: 'runtime' })
      return { models, cached: false, cachedAt: now, stale: false }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      warnRuntimeModelFetchFailed(message)
      return { models: [], cached: false, cachedAt: null, stale: false, error: message }
    } finally {
      inflightFetch = null
    }
  })()
  return inflightFetch
}
