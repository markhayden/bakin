/**
 * HTTP handlers for the versioned (asset-as-directory) model. These power the
 * versioned grid + detail route; they delegate to the asset service, whose
 * manifest writes trigger search reindex + the asset.changed SSE event.
 */
import { writeFileSync, mkdirSync, unlinkSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  listAssets, getAsset, promoteVersion, deleteVersion, deleteAsset, addExport, relink,
  addVersion, listTrashedAssets, restoreAsset, permanentlyDeleteTrashed, emptyAssetTrash,
} from '../lib/asset-service'
import type { AssetType } from '../lib/constants'

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function segmentsAfter(url: URL, marker: string): string[] {
  const parts = url.pathname.split('/').filter(Boolean)
  const idx = parts.indexOf(marker)
  return idx === -1 ? [] : parts.slice(idx + 1).map((s) => decodeURIComponent(s))
}

/** GET /trash — list trashed (whole-asset deleted) entries. */
export async function handleTrashList(): Promise<Response> {
  return Response.json({ items: listTrashedAssets() })
}

/** POST /trash/:trashName/restore — restore a trashed asset. */
export async function handleTrashRestore(req: Request): Promise<Response> {
  const trashName = segmentsAfter(new URL(req.url), 'trash')[0] || ''
  try {
    return Response.json({ ok: true, ...(await restoreAsset(trashName)) })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 400 })
  }
}

/** DELETE /trash/:trashName — permanently delete one trashed asset. */
export async function handleTrashPermanentDelete(req: Request): Promise<Response> {
  const trashName = segmentsAfter(new URL(req.url), 'trash')[0] || ''
  const ok = permanentlyDeleteTrashed(trashName)
  return ok ? Response.json({ ok: true }) : Response.json({ error: 'Not found in trash' }, { status: 404 })
}

/** DELETE /trash — empty the whole trash. */
export async function handleTrashEmpty(): Promise<Response> {
  return Response.json({ ok: true, deleted: emptyAssetTrash() })
}

function segmentsAfterVersioned(url: URL): string[] {
  const parts = url.pathname.split('/').filter(Boolean)
  const idx = parts.indexOf('versioned')
  return idx === -1 ? [] : parts.slice(idx + 1).map((s) => decodeURIComponent(s))
}

/** GET /versioned — list versioned assets (one summary per asset). */
export async function handleVersionedList(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const type = url.searchParams.get('type')
  const taskId = url.searchParams.get('taskId')
  const includeChildren = url.searchParams.get('includeChildren') === 'true'

  // includeChildren: match the task AND its subtasks (taskId--*) — done in the
  // route since the service filter is exact-match.
  if (taskId && includeChildren) {
    const prefix = `${taskId}--`
    const assets = listAssets(type ? { type: type as AssetType } : undefined)
      .filter((a) => a.taskId === taskId || (a.taskId !== null && a.taskId.startsWith(prefix)))
    return Response.json({ assets })
  }

  const filter: { type?: AssetType; taskId?: string | null } = {}
  if (type) filter.type = type as AssetType
  if (taskId !== null) filter.taskId = taskId
  const assets = listAssets(Object.keys(filter).length ? filter : undefined)
  return Response.json({ assets })
}

/** POST /versioned/:assetId/version — append a new version from an uploaded file. */
export async function handleVersionedAddVersion(req: Request): Promise<Response> {
  const assetId = segmentsAfterVersioned(new URL(req.url))[0] || ''
  if (!getAsset(assetId)) return Response.json({ error: 'Asset not found' }, { status: 404 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return Response.json({ error: 'Invalid multipart form data' }, { status: 400 })
  }
  let file: File | null = null
  for (const [key, value] of formData.entries()) {
    if ((key === 'file' || key === 'files') && typeof value !== 'string' && value !== null) {
      const f = value as unknown as { name?: string; size?: number }
      if (typeof f.name === 'string' && typeof f.size === 'number') { file = value as unknown as File; break }
    }
  }
  if (!file) return Response.json({ error: 'No file provided — use the "file" form field' }, { status: 400 })
  if (file.size === 0) return Response.json({ error: 'File is empty' }, { status: 400 })

  const tmpDir = join(tmpdir(), `bakin-addversion-${randomUUID()}`)
  mkdirSync(tmpDir, { recursive: true })
  // basename() the client-supplied filename — it's only a staging name (addVersion
  // derives the real vN.<ext>), and a raw name like "../../x" would escape tmpDir.
  const tmpPath = join(tmpDir, basename(file.name))
  try {
    writeFileSync(tmpPath, Buffer.from(await file.arrayBuffer()))
    const r = await addVersion(assetId, { sourceFilePath: tmpPath, op: 'upload' })
    return Response.json({ ok: true, assetId: r.assetId, version: r.version })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 400 })
  } finally {
    try { unlinkSync(tmpPath) } catch { /* best-effort */ }
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
}

/** POST /versioned/:assetId/relink — change/clear the asset's taskId. */
export async function handleVersionedRelink(req: Request): Promise<Response> {
  const assetId = segmentsAfterVersioned(new URL(req.url))[0] || ''
  const body = await req.json().catch(() => ({})) as { taskId?: unknown }
  const taskId = body.taskId === null ? null : typeof body.taskId === 'string' ? body.taskId : undefined
  if (taskId === undefined) return Response.json({ error: 'taskId (string or null) required' }, { status: 400 })
  try {
    return Response.json({ ok: true, asset: await relink(assetId, taskId) })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 400 })
  }
}

/** GET /versioned/:assetId — the full manifest. */
export async function handleVersionedGet(req: Request): Promise<Response> {
  const assetId = segmentsAfterVersioned(new URL(req.url))[0] || ''
  const manifest = getAsset(assetId)
  if (!manifest) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ asset: manifest })
}

/** POST /versioned/:assetId/promote — move the current pointer. */
export async function handleVersionedPromote(req: Request): Promise<Response> {
  const assetId = segmentsAfterVersioned(new URL(req.url))[0] || ''
  const body = await req.json().catch(() => ({})) as { version?: unknown }
  const version = Number(body.version)
  if (!Number.isInteger(version)) return Response.json({ error: 'version required' }, { status: 400 })
  try {
    return Response.json({ ok: true, asset: await promoteVersion(assetId, version) })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 400 })
  }
}

/** DELETE /versioned/:assetId/v/:version — delete one version. */
export async function handleVersionedDeleteVersion(req: Request): Promise<Response> {
  const seg = segmentsAfterVersioned(new URL(req.url)) // [assetId, 'v', version]
  const assetId = seg[0] || ''
  const version = Number(seg[2])
  if (!Number.isInteger(version)) return Response.json({ error: 'invalid version' }, { status: 400 })
  try {
    return Response.json({ ok: true, asset: await deleteVersion(assetId, version) })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 400 })
  }
}

/** DELETE /versioned/:assetId — trash the whole asset. */
export async function handleVersionedDeleteAsset(req: Request): Promise<Response> {
  const assetId = segmentsAfterVersioned(new URL(req.url))[0] || ''
  try {
    const { trashName } = await deleteAsset(assetId)
    return Response.json({ ok: true, trashName })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 400 })
  }
}

/** POST /versioned/:assetId/export — attach a derived export. */
export async function handleVersionedExport(req: Request): Promise<Response> {
  const assetId = segmentsAfterVersioned(new URL(req.url))[0] || ''
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const { surface, format, width, height } = body
  if (typeof surface !== 'string' || typeof format !== 'string' || typeof width !== 'number' || typeof height !== 'number') {
    return Response.json({ error: 'surface, format, width, height required' }, { status: 400 })
  }
  try {
    const r = await addExport(assetId, {
      surface, format: format as 'jpg' | 'png' | 'webp', width, height,
      fromVersion: typeof body.fromVersion === 'number' ? body.fromVersion : undefined,
      quality: typeof body.quality === 'number' ? body.quality : undefined,
    })
    return Response.json({ ok: true, ...r })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 400 })
  }
}
