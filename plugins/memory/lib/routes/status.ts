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
 * Counting lives in lib/status-snapshot.ts, shared with the
 * bakin_exec_memory_status exec tool.
 */
import { z } from 'zod'
import { defineRoute } from '@bakin/core/routing'
import type { PluginContextLite } from '@bakin/core/routing'
import type { PluginContext } from '@bakin/core/plugin-types'
import { statusSnapshot } from '../status-snapshot'

const passthrough = z.object({}).passthrough()
const errorResponse = z.object({ error: z.string() })

export const statusRoute = defineRoute({
  path: '/status',
  method: 'GET',
  description: 'Indexer health: per-tier row counts + offset snapshot',
  summary: 'Indexer health: per-tier row counts + offset snapshot',
  responses: { 200: passthrough, 400: errorResponse },
  handler: async (_req: Request, ctx: PluginContextLite) => {
    return Response.json(await statusSnapshot(ctx as unknown as PluginContext))
  },
})
