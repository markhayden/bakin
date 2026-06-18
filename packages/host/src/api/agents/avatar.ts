/**
 * GET /api/agents/avatar?id={agentId}
 * Serves an agent avatar (webp/png/jpg) from ~/.bakin/agents/{id}/ via the
 * shared resolver, which owns format detection, MIME typing, the agent-id
 * path-traversal guard, and conditional-request (ETag/304) handling.
 */
import { serveAvatar } from '@bakin/core/agents/avatar'

export async function get(req: Request, url: URL): Promise<Response> {
  const id = url.searchParams.get('id')
  if (!id) {
    return Response.json({ error: 'Missing id param' }, { status: 400 })
  }
  return serveAvatar(req, id)
}
