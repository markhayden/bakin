/**
 * GET /api/plugins/assets/list-trash — list trashed assets.
 */
import { join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { listTrash } from '../lib/trash'

export async function handleListTrash(_req: Request): Promise<Response> {
  const assetsRoot = join(getContentDir(), 'assets')
  const assets = listTrash(assetsRoot)
  return Response.json({ assets, count: assets.length })
}
