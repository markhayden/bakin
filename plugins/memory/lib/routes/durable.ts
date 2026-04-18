/**
 * Durable tier routes — browse canonical bootstrap files per agent.
 *
 *   GET /durable?agent=<id>          → { files: [{ name }] } for files present
 *   GET /durable/:agent/:basename    → { agent, file, content } for one file
 *
 * Both delegate to `openclaw-adapter` for disk reads — routes never touch
 * ~/.openclaw/ directly.
 */
import type { APIRoute, PluginContext } from '../../../../src/lib/plugin-types'
import { readDurableFile, CANONICAL_DURABLE_FILES } from '../openclaw-adapter'

export const durableListRoute: APIRoute = {
  path: '/durable',
  method: 'GET',
  description: 'List canonical durable files present for an agent',
  handler: async (req: Request, _ctx: PluginContext) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent')
    if (!agent) return Response.json({ error: 'agent required' }, { status: 400 })

    const files: { name: string }[] = []
    for (const name of CANONICAL_DURABLE_FILES) {
      if (readDurableFile(agent, name) !== null) files.push({ name })
    }
    return Response.json({ files })
  },
}

export const durableDetailRoute: APIRoute = {
  path: '/durable/:agent/:basename',
  method: 'GET',
  description: 'Read one canonical durable file for an agent',
  handler: async (req: Request, _ctx: PluginContext) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent')
    const basename = url.searchParams.get('basename')
    if (!agent || !basename) return Response.json({ error: 'agent and basename required' }, { status: 400 })

    const content = readDurableFile(agent, basename)
    if (content === null) return Response.json({ error: 'not found' }, { status: 404 })

    return Response.json({ agent, file: basename, content })
  },
}
