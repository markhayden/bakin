/**
 * Memory cleanup routes — find / dispatch / verify.
 *
 * The operator finds where a term appears across memory, dispatches a cleanup
 * task to each affected agent (the agent edits its OWN source files), and
 * verifies the term is gone by re-searching. Bakin never writes runtime memory.
 *
 * This file holds the find route (T1); dispatch + verify land in later commits.
 */
import { existsSync } from 'node:fs'

import { z } from 'zod'

import { defineRoute } from '@bakin/core/routing'
import type { PluginContextLite } from '@bakin/core/routing'
import type { SearchQueryParams } from '@bakin/core/plugin-types'
import { installedByPath, markUserEdited } from '@bakin/core/agent-packages/markers'

import { MEMORY_TIERS, type MemoryTier } from '../types'
import {
  composeTask,
  contentMatches,
  groupByAgent,
  matchingSnippets,
  tierLabel,
  type CleanupHit,
} from '../cleanup'

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
      const label = tierLabel(tier)
      const sourcePath = String(r.fields.source_path ?? '')
      hits.push({
        rowId: r.id,
        tier,
        agent: String(r.fields.agent ?? ''),
        sourcePath,
        label,
        snippets: matchingSnippets(content, term),
        // Only editable (actionable) sources can be package projections worth flagging.
        managed: label === 'actionable' && !!sourcePath && existsSync(installedByPath(sourcePath)),
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

const dispatchBody = z
  .object({
    term: z.string().min(1, 'term is required'),
    action: z.enum(['replace', 'remove']),
    replacement: z.string().optional(),
    agents: z.array(z.string().min(1)).min(1, 'at least one agent is required'),
    instruction: z.string().optional(),
  })
  .refine((b) => b.action !== 'replace' || (b.replacement?.length ?? 0) > 0, {
    message: 'replacement is required when action is "replace"',
    path: ['replacement'],
  })

export const cleanupDispatchRoute = defineRoute({
  path: '/cleanup/dispatch',
  method: 'POST',
  description: 'Dispatch a memory-cleanup task to each affected agent (agent edits its own files)',
  summary: 'Dispatch memory cleanup to agents',
  responses: { 200: passthrough, 400: errorResponse },
  handler: async (req: Request, ctx: PluginContextLite) => {
    const body = await parseJsonBody(req)
    if (body === null) return Response.json({ error: 'invalid JSON body' }, { status: 400 })
    const parsed = dispatchBody.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
    }

    const { term, action, replacement, agents, instruction } = parsed.data
    const dispatched: Array<{ agent: string; taskId: string; hitCount: number; managedCount: number }> = []
    const skipped: Array<{ agent: string; reason: string }> = []

    for (const agent of agents) {
      // Re-find server-side so the task reflects the current truth, not stale
      // client input. Only actionable hits go in the task — those are the files
      // the agent can edit; informational tiers self-heal and are left alone.
      const actionable = (await findCleanupHits(ctx, term, agent)).filter((h) => h.label === 'actionable')
      if (actionable.length === 0) {
        skipped.push({ agent, reason: 'no actionable occurrences' })
        continue
      }
      // Pin managed (package-projected) files as user-edited so the agent's
      // cleanup survives a later `agents update --refresh-template`. This writes
      // a Bakin projection-layer sentinel, not runtime-memory content.
      const managedPaths = actionable.filter((h) => h.managed && h.sourcePath).map((h) => h.sourcePath)
      for (const path of managedPaths) markUserEdited(path)

      const { title, description } = composeTask({ term, action, replacement, agent, hits: actionable, instruction })
      const task = await ctx.tasks.create({ agent, title, description, createdBy: 'memory' })
      ctx.activity.audit('memory.cleanup_dispatched', agent, {
        term,
        action,
        taskId: task.id,
        hitCount: actionable.length,
        managedCount: managedPaths.length,
      })
      dispatched.push({ agent, taskId: task.id, hitCount: actionable.length, managedCount: managedPaths.length })
    }

    return Response.json({ term, action, dispatched, skipped })
  },
})

const verifyBody = z.object({
  term: z.string().min(1, 'term is required'),
  agents: z.array(z.string().min(1)).min(1, 'at least one agent is required'),
})

export const cleanupVerifyRoute = defineRoute({
  path: '/cleanup/verify',
  method: 'POST',
  description: 'Re-check remaining occurrences of a term per agent after a cleanup',
  summary: 'Verify a memory cleanup',
  responses: { 200: passthrough, 400: errorResponse },
  handler: async (req: Request, ctx: PluginContextLite) => {
    const body = await parseJsonBody(req)
    if (body === null) return Response.json({ error: 'invalid JSON body' }, { status: 400 })
    const parsed = verifyBody.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
    }

    const { term, agents } = parsed.data
    const results = await Promise.all(
      agents.map(async (agent) => {
        const hits = await findCleanupHits(ctx, term, agent)
        const actionable = hits.filter((h) => h.label === 'actionable')
        // `clean` keys on actionable remaining: informational tiers (transcripts)
        // are intentionally left, so they don't count against a successful cleanup.
        return {
          agent,
          remaining: actionable,
          actionableRemaining: actionable.length,
          informationalRemaining: hits.length - actionable.length,
          clean: actionable.length === 0,
        }
      }),
    )
    return Response.json({ term, results })
  },
})
