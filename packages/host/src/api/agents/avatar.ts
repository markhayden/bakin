/**
 * GET /api/agents/avatar?id={agentId}
 * Serves agent avatar thumbnail from ~/.bakin/agents/{id}/avatar.jpg
 *
 * Migrated from src/app/api/agents/avatar/route.ts for Phase B of #147.
 */
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { getBakinPaths } from '@bakin/core/content-dir'

export async function get(_req: Request, url: URL): Promise<Response> {
  const id = url.searchParams.get('id')
  if (!id) {
    return Response.json({ error: 'Missing id param' }, { status: 400 })
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
