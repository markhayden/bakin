/**
 * GET /status — indexer health at a glance.
 *
 *   {
 *     countsByTier: { audit, durable, daily_note, session, turn, checkpoint, dream },
 *     totalRows: number,
 *     offsetsTracked: number,
 *     lastUpdated: number,  // ms
 *   }
 *
 * One Antfly query per tier with `limit: 0` — we only need `meta.total`.
 * A failure on one tier yields 0 for that tier rather than erroring the
 * whole response; the status view is for at-a-glance diagnostics, not a
 * source of truth.
 */
import type { APIRoute, PluginContext, SearchQueryParams } from '../../../../src/lib/plugin-types'
import { MEMORY_TIERS, type MemoryTier } from '../types'
import { getOffsetsFilePath } from '../offsets'
import { existsSync, readFileSync } from 'fs'
import { createLogger } from '../../../../src/core/logger'

const log = createLogger('memory:status')

async function countForTier(ctx: PluginContext, tier: MemoryTier): Promise<number> {
  const params: SearchQueryParams = {
    q: '',
    filters: { tier },
    limit: 0,
    offset: 0,
    rerank: false,
  }
  try {
    const res = await ctx.search.query(params)
    return res.meta?.total ?? 0
  } catch (err) {
    log.warn('status: tier count failed', { tier, err: err instanceof Error ? err.message : String(err) })
    return 0
  }
}

function offsetsTracked(): number {
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

export const statusRoute: APIRoute = {
  path: '/status',
  method: 'GET',
  description: 'Indexer health: per-tier row counts + offset snapshot',
  handler: async (_req: Request, ctx: PluginContext) => {
    const entries = await Promise.all(
      MEMORY_TIERS.map(async (t) => [t, await countForTier(ctx, t)] as const),
    )
    const countsByTier = Object.fromEntries(entries) as Record<MemoryTier, number>
    const totalRows = entries.reduce((sum, [, n]) => sum + n, 0)
    return Response.json({
      countsByTier,
      totalRows,
      offsetsTracked: offsetsTracked(),
      lastUpdated: Date.now(),
    })
  },
}
