/**
 * GET /api/plugins/assets/list — list assets with optional filters.
 */
import { listAssets } from '../lib/asset-index'

export async function handleList(req: Request): Promise<Response> {
  const url = new URL(req.url, 'http://localhost')
  const type = url.searchParams.get('type') || undefined
  const agent = url.searchParams.get('agent') || undefined
  const taskId = url.searchParams.get('taskId') || undefined
  const tag = url.searchParams.get('tag') || undefined

  const assets = listAssets({ type, agent, taskId, tag })
  return Response.json({ assets, count: assets.length })
}
