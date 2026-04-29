/**
 * bakin_exec_memory_status — indexer health snapshot.
 *
 * Same counts-by-tier shape the /status REST route returns, but in the
 * exec-tool response envelope so agents can read it without needing an
 * HTTP round-trip. Per-tier errors degrade to 0, matching the REST route's
 * "dashboard, not source of truth" stance.
 */
import type { ExecToolDefinition, PluginContext } from '@bakin/core/plugin-types'
import { MEMORY_TIERS, type MemoryTier } from '../lib/types'
import { getOffsetsFilePath } from '../lib/offsets'
import { existsSync, readFileSync } from 'fs'

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

export function createMemoryStatusTool(ctx: PluginContext): ExecToolDefinition {
  return {
    name: 'bakin_exec_memory_status',
    label: 'Read memory status',
    description: 'Indexer health: per-tier row counts, offset tracking, snapshot timestamp.',
    parameters: {},
    handler: async () => {
      const entries = await Promise.all(
        MEMORY_TIERS.map(async (tier) => {
          try {
            const res = await ctx.search.query({
              q: '',
              filters: { tier },
              limit: 0,
              offset: 0,
              rerank: false,
            })
            return [tier, res.meta?.total ?? 0] as const
          } catch {
            return [tier, 0] as const
          }
        }),
      )
      const countsByTier = Object.fromEntries(entries) as Record<MemoryTier, number>
      const totalRows = entries.reduce((sum, [, n]) => sum + n, 0)
      return {
        ok: true,
        countsByTier,
        totalRows,
        offsetsTracked: offsetsTracked(),
        lastUpdated: Date.now(),
      }
    },
  }
}
