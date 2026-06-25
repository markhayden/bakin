/**
 * Asset trash: soft-delete (move the asset directory under `assets/.trash/`),
 * list/restore/permanently-delete.
 *
 * Extracted from asset-service.ts. Self-contained — depends only on asset-id
 * (dir resolution), asset-lock (per-asset mutex), manifest (read), and the
 * task-asset index. Trash operations deliberately bypass the manifest-write
 * choke point (a rename, not a write), so they evict/relink the task-asset
 * index explicitly (the `taskAssetIndexRemove`/`taskAssetIndexUpsert` calls).
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { getContentDir } from '../../../src/core/content-dir'
import { assetDirAbs, assetDirRelPath } from './asset-id'
import { withAssetLock } from './asset-lock'
import { readManifest } from './manifest'
import { taskAssetIndexRemove, taskAssetIndexUpsert } from './task-asset-index'

const TRASH_SEPARATOR = '__deleted-'

/** Trash the whole asset directory (recoverable via restoreAsset). */
export async function deleteAsset(assetId: string): Promise<{ trashName: string }> {
  return withAssetLock(assetId, async () => {
    const dirAbs = assetDirAbs(assetId)
    if (!dirAbs || !existsSync(dirAbs)) throw new Error(`Asset not found: ${assetId}`)
    const trashRoot = join(getContentDir(), 'assets', '.trash')
    mkdirSync(trashRoot, { recursive: true })
    const trashName = `${assetId}${TRASH_SEPARATOR}${Date.now()}`
    renameSync(dirAbs, join(trashRoot, trashName))
    // Trash bypasses the manifest-write choke point — evict explicitly.
    taskAssetIndexRemove(assetId)
    return { trashName }
  })
}

export interface TrashedAssetInfo {
  trashName: string
  assetId: string
  type: string
  agent: string
  deletedAt: number
  versionCount: number
  description: string
}

const TRASH_SUFFIX_RE = new RegExp(`(.+)${TRASH_SEPARATOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`)

/** List trashed versioned assets (directories under .trash/). */
export function listTrashedAssets(): TrashedAssetInfo[] {
  const trashRoot = join(getContentDir(), 'assets', '.trash')
  if (!existsSync(trashRoot)) return []
  const out: TrashedAssetInfo[] = []
  for (const entry of readdirSync(trashRoot)) {
    const m = TRASH_SUFFIX_RE.exec(entry)
    if (!m) continue
    const dir = join(trashRoot, entry)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    const manifest = readManifest(dir)
    out.push({
      trashName: entry,
      assetId: m[1],
      type: manifest?.type ?? 'other',
      agent: manifest?.agent ?? 'unknown',
      deletedAt: Number(m[2]),
      versionCount: manifest?.versions.length ?? 0,
      description: manifest?.description ?? '',
    })
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt)
}

/** Permanently delete one trashed asset directory. */
export function permanentlyDeleteTrashed(trashName: string): boolean {
  if (!trashName || trashName.includes('/') || trashName.includes('..')) return false
  const dir = join(getContentDir(), 'assets', '.trash', trashName)
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}

/** Empty the whole asset trash. Returns the count removed. */
export function emptyAssetTrash(): number {
  const trashRoot = join(getContentDir(), 'assets', '.trash')
  if (!existsSync(trashRoot)) return 0
  const entries = readdirSync(trashRoot)
  let n = 0
  for (const entry of entries) {
    try { rmSync(join(trashRoot, entry), { recursive: true, force: true }); n++ } catch { /* skip */ }
  }
  return n
}

/** Restore a trashed asset directory back into the store. */
export async function restoreAsset(trashName: string): Promise<{ assetId: string }> {
  // Reject path-traversal in the trash entry name (matches permanentlyDeleteTrashed).
  if (!trashName || trashName.includes('/') || trashName.includes('\\') || trashName.includes('..')) {
    throw new Error(`Invalid trash name: ${trashName}`)
  }
  const assetId = trashName.split(TRASH_SEPARATOR)[0]
  const rel = assetDirRelPath(assetId)
  if (!rel) throw new Error(`Cannot restore — invalid assetId in: ${trashName}`)
  return withAssetLock(assetId, async () => {
    const trashPath = join(getContentDir(), 'assets', '.trash', trashName)
    if (!existsSync(trashPath)) throw new Error(`Trashed asset not found: ${trashName}`)
    const destAbs = join(getContentDir(), rel)
    if (existsSync(destAbs)) throw new Error(`Cannot restore — an asset already exists at ${assetId}`)
    mkdirSync(join(destAbs, '..'), { recursive: true })
    renameSync(trashPath, destAbs)
    // Restore bypasses the manifest-write choke point — relink explicitly.
    const restored = readManifest(destAbs)
    if (restored) taskAssetIndexUpsert(restored.assetId, restored.taskId ?? null)
    return { assetId }
  })
}
