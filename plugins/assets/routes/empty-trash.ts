/**
 * POST /api/plugins/assets/empty-trash — permanently delete all items in trash.
 */
import { join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { emptyTrash } from '../lib/trash'

export async function handleEmptyTrash(_req: Request): Promise<Response> {
  const assetsRoot = join(getContentDir(), 'assets')
  const deleted = emptyTrash(assetsRoot)
  return Response.json({ ok: true, deleted })
}
