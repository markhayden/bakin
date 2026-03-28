/**
 * GET /api/plugins/assets/list — list assets with optional filters.
 *
 * Rebuilds the index on each request because the watcher's sync hooks
 * run in the custom server process, not the Next.js API route process,
 * so the in-memory index doesn't receive live updates.
 *
 * When grouped=true (default), variants like thumbnails are nested under
 * their primary asset instead of appearing as separate entries.
 */
import { buildIndex, listAssets, listGroupedAssets } from '../lib/asset-index'

export async function handleList(req: Request): Promise<Response> {
  const url = new URL(req.url, 'http://localhost')
  const type = url.searchParams.get('type') || undefined
  const agent = url.searchParams.get('agent') || undefined
  const taskId = url.searchParams.get('taskId') || undefined
  const tag = url.searchParams.get('tag') || undefined
  const includeChildren = url.searchParams.get('includeChildren') === 'true'
  const grouped = url.searchParams.get('grouped') !== 'false'

  buildIndex()
  const filters = { type, agent, taskId, includeChildren, tag }

  if (grouped) {
    const groups = listGroupedAssets(filters)
    const assets = groups.map(g => ({
      ...g.primary,
      variants: g.variants.map(v => ({
        role: v.role,
        path: v.asset.path,
        filename: v.asset.filename,
        size: v.asset.size,
        mimeType: v.asset.mimeType,
      })),
    }))
    return Response.json({ assets, count: assets.length })
  }

  const assets = listAssets(filters)
  return Response.json({ assets, count: assets.length })
}
