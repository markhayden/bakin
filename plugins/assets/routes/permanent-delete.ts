/**
 * DELETE /api/plugins/assets/trash/:file — permanently delete a trashed asset.
 */
import { join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { permanentDelete } from '../lib/trash'

export async function handlePermanentDelete(req: Request): Promise<Response> {
  const url = new URL(req.url, 'http://localhost')
  const file = url.searchParams.get('file')

  if (!file) {
    return Response.json({ error: 'file parameter required' }, { status: 400 })
  }

  if (file.includes('/') || file.includes('..')) {
    return Response.json({ error: 'Invalid filename' }, { status: 400 })
  }

  const assetsRoot = join(getContentDir(), 'assets')
  const success = permanentDelete(file, assetsRoot)

  if (!success) {
    return Response.json({ error: 'Failed to permanently delete' }, { status: 500 })
  }

  return Response.json({ ok: true })
}
