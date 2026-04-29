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
import { existsSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { buildIndex, listAssets, listGroupedAssets, getAsset } from '../lib/asset-index'
import { isSafeCanonicalFilename, pathForFilename } from '../lib/path-for-filename'

export async function handleList(req: Request): Promise<Response> {
  const url = new URL(req.url, 'http://localhost')
  const type = url.searchParams.get('type') || undefined
  const agent = url.searchParams.get('agent') || undefined
  const taskId = url.searchParams.get('taskId') || undefined
  const tag = url.searchParams.get('tag') || undefined
  const includeChildren = url.searchParams.get('includeChildren') === 'true'
  const grouped = url.searchParams.get('grouped') !== 'false'
  const filename = url.searchParams.get('filename') || undefined

  buildIndex()

  // Single-asset lookup by filename — stable under retype/relink.
  if (filename) {
    if (!isSafeCanonicalFilename(filename)) return Response.json({ assets: [], count: 0, total: 0 })
    const derived = pathForFilename(filename)
    const path = derived && existsSync(join(getContentDir(), derived)) ? derived : undefined
    if (!path) return Response.json({ assets: [], count: 0, total: 0 })
    const asset = getAsset(path)
    if (!asset) return Response.json({ assets: [], count: 0, total: 0 })
    if (grouped) {
      const groups = listGroupedAssets()
      const group = groups.find(g => g.primary.path === path)
      if (group) {
        const enriched = {
          ...group.primary,
          variants: group.variants.map(v => ({
            role: v.role,
            path: v.asset.path,
            filename: v.asset.filename,
            size: v.asset.size,
            mimeType: v.asset.mimeType,
          })),
        }
        return Response.json({ assets: [enriched], count: 1, total: 1 })
      }
    }
    return Response.json({ assets: [asset], count: 1, total: 1 })
  }

  const filters = { type, agent, taskId, includeChildren, tag }

  // Pagination params
  const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined
  const offset = url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!, 10) : 0

  if (grouped) {
    const groups = listGroupedAssets(filters)
    const total = groups.length
    const paged = limit ? groups.slice(offset, offset + limit) : groups.slice(offset)
    const assets = paged.map(g => ({
      ...g.primary,
      variants: g.variants.map(v => ({
        role: v.role,
        path: v.asset.path,
        filename: v.asset.filename,
        size: v.asset.size,
        mimeType: v.asset.mimeType,
      })),
    }))
    return Response.json({ assets, count: assets.length, total })
  }

  const all = listAssets(filters)
  const total = all.length
  const assets = limit ? all.slice(offset, offset + limit) : all.slice(offset)
  return Response.json({ assets, count: assets.length, total })
}
