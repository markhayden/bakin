/**
 * GET /record?id=<rowId> — resolve one unified memory rowId to its exact row.
 *
 * Backs the ⌘K deep link (/memory?recordId=<rowId>). The tier prefix of the
 * id (`durable:`, `session:`, `audit:`, …) selects a tier, and the
 * side-effect-free enumerator re-derives that tier's rows from source files
 * until the key matches (lazy, early-exit). Deliberately search-engine-
 * independent — a deep link resolves even when antfly is down.
 *
 * The audit tier goes through MemoryIndexer.findAuditRowById — a streaming
 * reader with early exit, because audit.jsonl is append-only and unbounded
 * and must never be materialized per-request. It applies the same retention
 * filter as live indexing.
 *
 * (An index-first exact-id lookup was tried and rejected: row keys are not
 * indexed as searchable text, so `q=<rowId>` returns unrelated hits — the
 * old bakin_exec_search_lookup shipped broken on that same trick before it
 * moved to SearchAdapter.documents.get.)
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
import { MEMORY_TIERS, type MemoryTier } from '../types'

const passthrough = z.object({}).passthrough()
const errorResponse = z.object({ error: z.string() })

/** Row-id prefix → owning tier. Identity for every tier in MEMORY_TIERS,
 *  plus `skill:` rows, which are emitted by the durable tier enumeration
 *  (skills are durable memory). */
const PREFIX_TO_TIER: Record<string, MemoryTier> = {
  ...Object.fromEntries(MEMORY_TIERS.map((t) => [t, t])) as Record<MemoryTier, MemoryTier>,
  skill: 'durable',
}

const RowIdSchema = z.string().min(3).refine((v) => v.includes(':'), 'expected <tier>:<hash>')

export const recordRoute = defineRoute({
  path: '/record',
  method: 'GET',
  summary: 'Resolve one memory row by its unified rowId',
  description: 'Resolve a unified memory rowId (<tier>:<hash>) to its exact row via tier enumeration (streaming early-exit for the audit tier)',
  responses: { 200: passthrough, 400: errorResponse, 404: errorResponse },
  handler: async (req: Request, ctx: PluginContextLite) => {
    const raw = new URL(req.url).searchParams.get('id') ?? ''
    const parsed = RowIdSchema.safeParse(raw)
    const tier = parsed.success ? PREFIX_TO_TIER[parsed.data.split(':', 1)[0]!] : undefined
    if (!parsed.success || !tier) {
      return Response.json({ error: 'invalid id — expected <tier>:<hash>' }, { status: 400 })
    }
    const id = parsed.data

    const pluginCtx = ctx as unknown as PluginContext
    const indexer = new MemoryIndexer(pluginCtx, resolveIndexerOptions(pluginCtx))

    if (tier === 'audit') {
      // I/O errors (not ENOENT) are logged by the indexer and bubble to the
      // server's 500 handler — never masked as a 404.
      const row = await indexer.findAuditRowById(id)
      if (row) {
        return Response.json({ result: { id: row.key, table: 'memory', fields: row.doc, score: 0 } })
      }
      return Response.json({ error: 'record not found' }, { status: 404 })
    }

    for await (const { key, doc } of indexer.enumerateTier(tier)) {
      if (key === id) {
        return Response.json({ result: { id: key, table: 'memory', fields: doc, score: 0 } })
      }
    }
    return Response.json({ error: 'record not found' }, { status: 404 })
  },
})
