import { ASSET_TYPES, type AssetType } from '../lib/constants'
import { retypeAsset } from '../lib/retype'

export async function handleRetype(req: Request): Promise<Response> {
  let body: { path?: string; type?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.path || typeof body.path !== 'string') {
    return Response.json({ error: 'Missing required field: path' }, { status: 400 })
  }

  if (!body.type || !ASSET_TYPES.includes(body.type as AssetType)) {
    return Response.json({ error: `Invalid type: ${body.type}. Must be one of: ${ASSET_TYPES.join(', ')}` }, { status: 400 })
  }

  const result = retypeAsset({ assetPath: body.path, newType: body.type as AssetType })

  if (!result.ok) {
    const status = result.error === 'Asset not found' ? 404 : 400
    return Response.json(result, { status })
  }

  return Response.json(result)
}
