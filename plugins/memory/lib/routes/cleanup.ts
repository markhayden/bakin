/**
 * Memory cleanup routes — find / dispatch / verify.
 *
 * The operator finds where a term appears across memory, dispatches a cleanup
 * task to each affected agent (the agent edits its OWN source files), and
 * verifies the term is gone by re-searching. Bakin never writes runtime memory.
 *
 * This file holds the find route (T1); dispatch + verify land in later commits.
 */
import { z } from 'zod'

import { defineRoute } from '@bakin/core/routing'
import type { PluginContextLite } from '@bakin/core/routing'
import type { SearchQueryParams } from '@bakin/core/plugin-types'

import { MEMORY_TIERS, type MemoryTier } from '../types'
import { contentMatches, groupByAgent, matchingSnippets, tierLabel, type CleanupHit } from '../cleanup'

const passthrough = z.object({}).passthrough()
const errorResponse = z.object({ error: z.string() })

// Generous per-tier overshoot: full_text_only ranking is arbitrary, so pull a
// wide window and let the exact-substring filter decide the true occurrences.
const OVERSHOOT_PER_TIER = 200

const findBody = z.object({
  term: z.string().min(1, 'term is required'),
  agent: z.string().optional(),
})

/**
 * Find every true occurrence of `term` across all memory tiers (optionally
 * scoped to one agent). Queries per tier with the match-all/full-text strategy,
 * then exact-substring-filters `content` so semantic ranking can't leak false
 * hits. Shared by the dispatch + verify routes.
 */
export async function findCleanupHits(
  ctx: PluginContextLite,
  term: string,
  agent?: string,
): Promise<CleanupHit[]> {
  const perTier = await Promise.all(
    MEMORY_TIERS.map(async (tier) => {
      const filters: Record<string, string> = { tier }
      if (agent) filters.agent = agent
      const params: SearchQueryParams = {
        q: term,
        filters,
        limit: OVERSHOOT_PER_TIER,
        offset: 0,
        rerank: false,
        strategy: 'full_text_only',
      }
      try {
        const res = await ctx.search.query(params)
        return res.results
      } catch {
        return []
      }
    }),
  )

  const hits: CleanupHit[] = []
  for (const results of perTier) {
    for (const r of results) {
      const content = String(r.fields.content ?? '')
      if (!contentMatches(content, term)) continue
      const tier = String(r.fields.tier ?? '') as MemoryTier
      hits.push({
        rowId: r.id,
        tier,
        agent: String(r.fields.agent ?? ''),
        sourcePath: String(r.fields.source_path ?? ''),
        label: tierLabel(tier),
        snippets: matchingSnippets(content, term),
      })
    }
  }
  return hits
}

async function parseJsonBody(req: Request): Promise<unknown | null> {
  try {
    return await req.json()
  } catch {
    return null
  }
}

export const cleanupFindRoute = defineRoute({
  path: '/cleanup/find',
  method: 'POST',
  description: 'Find exact occurrences of a term across memory tiers, grouped by agent',
  summary: 'Find a term across memory for cleanup',
  responses: { 200: passthrough, 400: errorResponse },
  handler: async (req: Request, ctx: PluginContextLite) => {
    const body = await parseJsonBody(req)
    if (body === null) return Response.json({ error: 'invalid JSON body' }, { status: 400 })
    const parsed = findBody.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
    }

    const { term, agent } = parsed.data
    const hits = await findCleanupHits(ctx, term, agent)
    return Response.json({
      term,
      groups: groupByAgent(hits),
      totalHits: hits.length,
      actionableHits: hits.filter((h) => h.label === 'actionable').length,
    })
  },
})
