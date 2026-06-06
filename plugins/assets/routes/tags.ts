/**
 * HTTP handlers for global tag operations — rename/remove across the whole
 * store and bulk apply over a set of assets. These power the folders view and
 * bulk-select tagging; each underlying mutation is an atomic manifest write
 * the watcher picks up for reindex + the asset.changed SSE event.
 */
import { renameTagGlobal, removeTagGlobal, applyTags } from '../lib/asset-service'

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** POST /tags/rename — rename a tag across all assets carrying it. */
export async function handleTagsRename(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { from?: unknown; to?: unknown }
  const from = typeof body.from === 'string' ? body.from.trim() : ''
  const to = typeof body.to === 'string' ? body.to.trim() : ''
  if (!from || !to) return Response.json({ error: 'from and to (non-empty strings) required' }, { status: 400 })
  try {
    return Response.json({ ok: true, ...(await renameTagGlobal(from, to)) })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 400 })
  }
}

/** POST /tags/remove — remove a tag from all assets carrying it. */
export async function handleTagsRemove(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { tag?: unknown }
  const tag = typeof body.tag === 'string' ? body.tag.trim() : ''
  if (!tag) return Response.json({ error: 'tag (non-empty string) required' }, { status: 400 })
  try {
    return Response.json({ ok: true, ...(await removeTagGlobal(tag)) })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 400 })
  }
}

/** POST /tags/apply — bulk add/remove tags on a set of assets. */
export async function handleTagsApply(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { assetIds?: unknown; add?: unknown; remove?: unknown }
  const assetIds = Array.isArray(body.assetIds) && body.assetIds.every((id) => typeof id === 'string') ? body.assetIds as string[] : []
  const add = Array.isArray(body.add) && body.add.every((t) => typeof t === 'string') ? body.add as string[] : undefined
  const remove = Array.isArray(body.remove) && body.remove.every((t) => typeof t === 'string') ? body.remove as string[] : undefined
  if (assetIds.length === 0) return Response.json({ error: 'assetIds (non-empty string[]) required' }, { status: 400 })
  if (!add?.length && !remove?.length) return Response.json({ error: 'add and/or remove (string[]) required' }, { status: 400 })
  try {
    return Response.json({ ok: true, ...(await applyTags(assetIds, { add, remove })) })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 400 })
  }
}
