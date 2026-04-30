/**
 * `searchRoute({ table })` — factory for the per-plugin `GET /search` route.
 *
 * Replaces the auto-wired search route that `ctx.search.registerContentType`
 * historically created as a side effect during `activate()`. Plugins now
 * include this in their declarative `routes: [...]` array — the schemas
 * are bound at module scope, but the handler reads `ctx.search` at request
 * time (no closure over `activate()`-initialized services).
 */

import { z } from 'zod'
import { defineRoute } from './define'
import type { APIRoute, PluginContextLite } from './types'

const searchQuery = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  facets: z.string().optional(),  // comma-separated; handler splits
})

const searchResponse = z.object({
  results: z.array(z.unknown()),
  aggregations: z.unknown().optional(),
  meta: z.object({
    query: z.string(),
    total: z.number(),
    took_ms: z.number(),
    source: z.string(),
  }).optional(),
})

const errorResponse = z.object({ error: z.string() })

/**
 * Returns the standard `GET /search` route for a plugin's content type.
 * Plugins consume it by including the result in their `routes` array.
 */
export function searchRoute(opts: { table: string; description?: string }):
  APIRoute<PluginContextLite, undefined, z.infer<typeof searchQuery>, undefined> {
  return defineRoute({
    path: '/search',
    method: 'GET',
    summary: `Search ${opts.table}`,
    description: opts.description ?? `Full-text search across ${opts.table} indexed content.`,
    query: searchQuery,
    responses: { 200: searchResponse, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, parsed) => {
      const result = await ctx.search.query({
        q: parsed.query.q,
        limit: parsed.query.limit,
        offset: parsed.query.offset,
        facets: parsed.query.facets?.split(',').filter(Boolean),
      })
      return Response.json(result)
    },
  })
}
