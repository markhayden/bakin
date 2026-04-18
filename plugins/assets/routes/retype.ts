import { ASSET_TYPES, type AssetType } from '../lib/constants'
import { retypeAsset } from '../lib/retype'

export async function handleRetype(req: Request): Promise<Response> {
  let body: { filename?: string; type?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.filename || typeof body.filename !== 'string') {
    return Response.json({ error: 'Missing required field: filename' }, { status: 400 })
  }

  if (!body.type || !ASSET_TYPES.includes(body.type as AssetType)) {
    return Response.json({ error: `Invalid type: ${body.type}. Must be one of: ${ASSET_TYPES.join(', ')}` }, { status: 400 })
  }

  const result = retypeAsset({ filename: body.filename, newType: body.type as AssetType })

  if (!result.ok) {
    const status = result.error === 'Asset not found' ? 404 : 400
    return Response.json(result, { status })
  }

  return Response.json(result)
}
