/**
 * GET /api/plugins/assets/list — list assets with optional filters.
 *
 * Rebuilds the index on each request because the watcher's sync hooks
 * run in the custom server process, not the Next.js API route process,
 * so the in-memory index doesn't receive live updates.
 */
import { buildIndex, listAssets } from '../lib/asset-index'

export async function handleList(req: Request): Promise<Response> {
  const url = new URL(req.url, 'http://localhost')
  const type = url.searchParams.get('type') || undefined
  const agent = url.searchParams.get('agent') || undefined
  const taskId = url.searchParams.get('taskId') || undefined
  const tag = url.searchParams.get('tag') || undefined
  const includeChildren = url.searchParams.get('includeChildren') === 'true'

  buildIndex()
  const assets = listAssets({ type, agent, taskId, includeChildren, tag })
  return Response.json({ assets, count: assets.length })
}
