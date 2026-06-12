/**
 * GET /api/agents/avatar?id={agentId}
 * Serves agent avatar thumbnail from ~/.bakin/agents/{id}/avatar.jpg
 *
 * Migrated from src/app/api/agents/avatar/route.ts for Phase B of #147.
 */
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { getBakinPaths } from '@bakin/core/content-dir'

/**
 * Agent ids are safe slugs — no separators means the join below can never
 * escape the agents root. Leading alphanumeric also rejects `.`/`..`.
 */
const AGENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export async function get(_req: Request, url: URL): Promise<Response> {
  const id = url.searchParams.get('id')
  if (!id) {
    return Response.json({ error: 'Missing id param' }, { status: 400 })
  }
  if (!AGENT_ID_RE.test(id)) {
    return Response.json({ error: 'Invalid agent id' }, { status: 400 })
  }

  const { agents } = getBakinPaths()
  const avatarPath = join(agents, id, 'avatar.jpg')

  if (!existsSync(avatarPath)) {
    return new Response(null, { status: 404 })
  }

  const data = readFileSync(avatarPath)
  // Convert Buffer to Uint8Array for the Web Response body.
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  })
}
