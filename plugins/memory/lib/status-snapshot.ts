/**
 * Shared indexer-health snapshot for the /status REST route and the
 * bakin_exec_memory_status exec tool — ONE implementation of tier counting
 * so the two surfaces can't drift.
 *
 * Counts come from a single search query with a `tier` facet. The naive
 * per-tier `limit: 0` + `meta.total` approach reads 0 for every tier on the
 * pinned engine (total is returned-hit count, not corpus size). A search
 * failure degrades to all-zero counts — this is a dashboard, not a source
 * of truth.
 */
import { existsSync, readFileSync } from 'fs'
import type { PluginContext, SearchQueryParams } from '@bakin/core/plugin-types'
import { MEMORY_TIERS, type MemoryTier } from './types'
import { getOffsetsFilePath } from './offsets'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('memory:status')

export async function countsByTier(ctx: PluginContext): Promise<Record<MemoryTier, number>> {
  const counts = Object.fromEntries(MEMORY_TIERS.map((t) => [t, 0])) as Record<MemoryTier, number>
  // q: '*' so full-text matches every doc (empty q scores nothing), and
  // full_text_only so semantic adapters — which can reject tiny-limit
  // queries — stay out of a pure counting call.
  const params: SearchQueryParams = {
    q: '*',
    facets: ['tier'],
    limit: 1,
    offset: 0,
    rerank: false,
    strategy: 'full_text_only',
  }
  try {
    const res = await ctx.search.query(params)
    // Plugin-facing responses carry facet counts under `aggregations`
    // (mapFacetCounts in search-plugin-api) — NOT the adapter-level `facets`.
    for (const facet of res.aggregations?.tier ?? []) {
      const tier = String(facet.value) as MemoryTier
      if (tier in counts) counts[tier] = facet.count
    }
  } catch (err) {
    log.warn('status: tier facet count failed', { err: err instanceof Error ? err.message : String(err) })
  }
  return counts
}

export function offsetsTracked(): number {
  const file = getOffsetsFilePath()
  if (!existsSync(file)) return 0
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    if (parsed && typeof parsed === 'object') {
      return Object.keys(parsed as Record<string, unknown>).length
    }
  } catch {
    return 0
  }
  return 0
}

export interface StatusSnapshot {
  countsByTier: Record<MemoryTier, number>
  totalRows: number
  offsetsTracked: number
  lastUpdated: number
}

export async function statusSnapshot(ctx: PluginContext): Promise<StatusSnapshot> {
  const counts = await countsByTier(ctx)
  return {
    countsByTier: counts,
    totalRows: Object.values(counts).reduce((sum, n) => sum + n, 0),
    offsetsTracked: offsetsTracked(),
    lastUpdated: Date.now(),
  }
}
