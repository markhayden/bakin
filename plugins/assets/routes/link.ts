/**
 * PATCH /api/plugins/assets/link — relink or unlink an asset from a task.
 * Body: { filename: string, taskId: string | null }
 */
import { relinkAsset } from '../lib/relink'

export async function handleLink(req: Request): Promise<Response> {
  let body: { filename?: string; taskId?: string | null }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.filename || typeof body.filename !== 'string') {
    return Response.json({ error: 'Missing required field: filename' }, { status: 400 })
  }

  const newTaskId = body.taskId === undefined || body.taskId === null ? null : String(body.taskId)

  const result = relinkAsset({ filename: body.filename, newTaskId })

  if (!result.ok) {
    const status = result.error === 'Asset not found' ? 404 : 400
    return Response.json(result, { status })
  }

  return Response.json(result)
}
