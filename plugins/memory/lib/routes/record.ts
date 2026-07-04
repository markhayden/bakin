/**
 * GET /record?id=<rowId> — resolve one unified memory rowId to its exact row.
 *
 * Backs the ⌘K deep link (/memory?recordId=<rowId>): the tier prefix of the
 * id (`durable:`, `session:`, `audit:`, …) selects a tier, and the
 * side-effect-free enumerator re-derives that tier's rows from source files
 * until the key matches. Deliberately search-engine-independent — a deep
 * link resolves even when antfly is down. The enumerator is lazy, so
 * consumption stops at the first match.
 *
 * Response is SearchResult-shaped ({ id, table, fields, score }) so the
 * client can hand it straight to MemoryDetailDrawer.
 */
import { z } from 'zod'
import { defineRoute } from '@bakin/core/routing'
import type { PluginContextLite } from '@bakin/core/routing'
import type { PluginContext } from '@bakin/core/plugin-types'
import { MemoryIndexer } from '../indexer'
import { resolveIndexerOptions } from '../settings'
import type { MemoryTier } from '../types'

const passthrough = z.object({}).passthrough()
const errorResponse = z.object({ error: z.string() })

/** Row-id prefix → owning tier. `skill:` rows are emitted by the durable
 *  tier enumeration (skills are durable memory). */
const PREFIX_TO_TIER: Record<string, MemoryTier> = {
  session: 'session',
  turn: 'turn',
  checkpoint: 'checkpoint',
  daily_note: 'daily_note',
  dream: 'dream',
  durable: 'durable',
  skill: 'durable',
  audit: 'audit',
}

const RowIdSchema = z.string().min(3).refine((v) => v.includes(':'), 'expected <tier>:<hash>')

export const recordRoute = defineRoute({
  path: '/record',
  method: 'GET',
  summary: 'Resolve one memory row by its unified rowId',
  description: 'Resolve a unified memory rowId (<tier>:<hash>) to its exact row via tier enumeration',
  responses: { 200: passthrough, 400: errorResponse, 404: errorResponse },
  handler: async (req: Request, ctx: PluginContextLite) => {
    const raw = new URL(req.url).searchParams.get('id') ?? ''
    const parsed = RowIdSchema.safeParse(raw)
    const tier = parsed.success ? PREFIX_TO_TIER[parsed.data.split(':', 1)[0]!] : undefined
    if (!parsed.success || !tier) {
      return Response.json({ error: 'invalid id — expected <tier>:<hash>' }, { status: 400 })
    }

    const pluginCtx = ctx as unknown as PluginContext
    const indexer = new MemoryIndexer(pluginCtx, resolveIndexerOptions(pluginCtx))
    for await (const { key, doc } of indexer.enumerateTier(tier)) {
      if (key === parsed.data) {
        return Response.json({ result: { id: key, table: 'memory', fields: doc, score: 0 } })
      }
    }
    return Response.json({ error: 'record not found' }, { status: 404 })
  },
})
