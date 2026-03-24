/**
 * DELETE /api/plugins/assets/delete?path=... — soft-delete an asset.
 * Moves asset + sidecar to .trash/ directory.
 */
import { join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { softDelete } from '../lib/trash'
import { removeAsset } from '../lib/asset-index'

export async function handleDelete(req: Request): Promise<Response> {
  const url = new URL(req.url, 'http://localhost')
  const assetPath = url.searchParams.get('path')

  if (!assetPath) {
    return Response.json({ error: 'path parameter required' }, { status: 400 })
  }

  // Prevent path traversal
  if (assetPath.includes('..') || !assetPath.startsWith('assets/')) {
    return Response.json({ error: 'Invalid path' }, { status: 400 })
  }

  const contentDir = getContentDir()
  const fullPath = join(contentDir, assetPath)
  const assetsRoot = join(contentDir, 'assets')

  const success = softDelete(fullPath, assetsRoot)
  if (success) {
    removeAsset(assetPath)
    return Response.json({ ok: true, trashed: assetPath })
  }

  return Response.json({ error: 'Failed to delete asset' }, { status: 500 })
}
