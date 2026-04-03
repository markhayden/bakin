/**
 * POST /api/plugins/assets/trash/:file/restore — restore a trashed asset.
 */
import { join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { restoreAsset } from '../lib/trash'
import { upsertAsset } from '../lib/asset-index'

export async function handleRestore(req: Request): Promise<Response> {
  const url = new URL(req.url, 'http://localhost')
  const file = url.searchParams.get('file')

  if (!file) {
    return Response.json({ error: 'file parameter required' }, { status: 400 })
  }

  // Prevent path traversal
  if (file.includes('/') || file.includes('..')) {
    return Response.json({ error: 'Invalid filename' }, { status: 400 })
  }

  const assetsRoot = join(getContentDir(), 'assets')
  const restoredPath = restoreAsset(file, assetsRoot)

  if (!restoredPath) {
    return Response.json({ error: 'Failed to restore asset' }, { status: 500 })
  }

  // Re-index the restored asset
  upsertAsset(restoredPath)

  return Response.json({ ok: true, restoredPath })
}
