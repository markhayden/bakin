/**
 * GET /record?id=<rowId> — resolve one unified memory rowId to its exact row.
 *
 * Backs the ⌘K deep link (/memory?recordId=<rowId>). The tier prefix of the
 * id (`durable:`, `session:`, `audit:`, …) selects a tier, and the
 * side-effect-free enumerator re-derives that tier's rows from source files
 * until the key matches (lazy, early-exit). Deliberately search-engine-
 * independent — a deep link resolves even when antfly is down.
 *
 * The audit tier gets a dedicated line-streaming reader with early exit:
 * audit.jsonl is append-only and unbounded, and the indexer's
 * collectAuditRows() slurps the whole file into one Buffer, which must
 * never happen per-request on the server's event loop.
 *
 * (An index-first exact-id lookup was tried and rejected: row keys are not
 * indexed as searchable text, so `q=<rowId>` returns unrelated hits — the
 * same reason bakin_exec_search_lookup's text-then-filter trick misses.)
 *
 * Response is SearchResult-shaped ({ id, table, fields, score }) so the
 * client can hand it straight to MemoryDetailDrawer.
 */
import { createReadStream } from 'fs'
import { createInterface } from 'readline'
import { join } from 'path'
import { z } from 'zod'
import { getContentDir } from '@bakin/core/content-dir'
import { defineRoute } from '@bakin/core/routing'
import type { PluginContextLite } from '@bakin/core/routing'
import type { PluginContext } from '@bakin/core/plugin-types'
import { MemoryIndexer, buildMemoryDoc } from '../indexer'
import { parseAuditLine } from '../tier-parsers/audit-parser'
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

/** Stream audit.jsonl line by line, early-exit on the matching row —
 *  never materializes the whole file. */
async function findAuditRow(id: string): Promise<Record<string, unknown> | null> {
  const file = join(getContentDir(), 'audit.jsonl')
  const stream = createReadStream(file, { encoding: 'utf-8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let offset = 0
  try {
    for await (const line of lines) {
      const row = parseAuditLine(line, file, offset)
      offset += Buffer.byteLength(line, 'utf-8') + 1
      if (row && row.id === id) {
        return { id: row.id, table: 'memory', fields: buildMemoryDoc(row), score: 0 }
      }
    }
  } catch {
    return null // missing/unreadable file — treated as not found
  } finally {
    lines.close()
    stream.destroy()
  }
  return null
}

export const recordRoute = defineRoute({
  path: '/record',
  method: 'GET',
  summary: 'Resolve one memory row by its unified rowId',
  description: 'Resolve a unified memory rowId (<tier>:<hash>) to its exact row — index lookup first, tier enumeration fallback',
  responses: { 200: passthrough, 400: errorResponse, 404: errorResponse },
  handler: async (req: Request, ctx: PluginContextLite) => {
    const raw = new URL(req.url).searchParams.get('id') ?? ''
    const parsed = RowIdSchema.safeParse(raw)
    const tier = parsed.success ? PREFIX_TO_TIER[parsed.data.split(':', 1)[0]!] : undefined
    if (!parsed.success || !tier) {
      return Response.json({ error: 'invalid id — expected <tier>:<hash>' }, { status: 400 })
    }
    const id = parsed.data

    if (tier === 'audit') {
      const row = await findAuditRow(id)
      if (row) return Response.json({ result: row })
      return Response.json({ error: 'record not found' }, { status: 404 })
    }

    const pluginCtx = ctx as unknown as PluginContext
    const indexer = new MemoryIndexer(pluginCtx, resolveIndexerOptions(pluginCtx))
    for await (const { key, doc } of indexer.enumerateTier(tier)) {
      if (key === id) {
        return Response.json({ result: { id: key, table: 'memory', fields: doc, score: 0 } })
      }
    }
    return Response.json({ error: 'record not found' }, { status: 404 })
  },
})
