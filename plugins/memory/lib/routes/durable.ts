/**
 * Durable tier routes — browse canonical bootstrap files per agent.
 *
 *   GET /durable?agent=<id>          → { files: [{ name }] } for files present
 *   GET /durable/:agent/:basename    → { agent, file, content } for one file
 *
 * Both delegate to the runtime memory adapter. Routes never touch provider
 * files directly.
 */
import { defineRoute } from '@bakin/core/routing'
import type { PluginContextLite } from '@bakin/core/routing'
import type { APIRoute, PluginContext } from '@bakin/core/plugin-types'
import { CANONICAL_DURABLE_FILES } from '../durable-kinds'
import { getRuntimeMemoryEntry } from '../runtime-memory'

export const durableListRoute = defineRoute({
  path: '/durable',
  method: 'GET',
  description: 'List canonical durable files present for an agent',
  handler: async (req: Request, ctx: PluginContextLite) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent')
    if (!agent) return Response.json({ error: 'agent required' }, { status: 400 })

    const files: { name: string }[] = []
    for (const name of CANONICAL_DURABLE_FILES) {
      if (await getRuntimeMemoryEntry(ctx as unknown as PluginContext, 'durable', name, agent)) files.push({ name })
    }
    return Response.json({ files })
  },
})

export const durableDetailRoute = defineRoute({
  path: '/durable/:agent/:basename',
  method: 'GET',
  description: 'Read one canonical durable file for an agent',
  handler: async (req: Request, ctx: PluginContextLite) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent')
    const basename = url.searchParams.get('basename')
    if (!agent || !basename) return Response.json({ error: 'agent and basename required' }, { status: 400 })

    const entry = await getRuntimeMemoryEntry(ctx as unknown as PluginContext, 'durable', basename, agent)
    if (!entry) return Response.json({ error: 'not found' }, { status: 404 })

    return Response.json({ agent, file: basename, content: entry.content })
  },
})
