/**
 * In-memory taskId → assetIds index.
 *
 * Backs the `assets.listByTask` hook so dispatch resolves a task's attached
 * assets in O(1) instead of scanning every manifest in the store (and without
 * depending on the optional search index). Membership only — manifest content
 * is always read fresh from disk by consumers.
 *
 * Maintained synchronously at the manifest-write choke point
 * (`writeManifestAtomic`) plus the trash/restore paths that bypass it; the
 * content watcher's onSync/onUnlink handlers act as the self-heal backstop
 * for externally edited manifests. Built lazily with one store scan.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

import { getContentDir } from '../../../src/core/content-dir'

const taskToAssets = new Map<string, Set<string>>()
const assetToTask = new Map<string, string | null>()
let built = false

function upsert(assetId: string, taskId: string | null): void {
  const prev = assetToTask.get(assetId)
  if (prev != null && prev !== taskId) {
    taskToAssets.get(prev)?.delete(assetId)
  }
  assetToTask.set(assetId, taskId)
  if (taskId) {
    let bucket = taskToAssets.get(taskId)
    if (!bucket) {
      bucket = new Set()
      taskToAssets.set(taskId, bucket)
    }
    bucket.add(assetId)
  }
}

/** Record an asset's current task link (call on every manifest write). */
export function taskAssetIndexUpsert(assetId: string, taskId: string | null | undefined): void {
  upsert(assetId, taskId ?? null)
}

/** Drop an asset from the index (trash/unlink). */
export function taskAssetIndexRemove(assetId: string): void {
  const prev = assetToTask.get(assetId)
  if (prev != null) taskToAssets.get(prev)?.delete(assetId)
  assetToTask.delete(assetId)
}

// Minimal tolerant manifest read — only the two fields the index needs.
// Deliberately NOT importing ./manifest (which calls back into this module on
// write) so the dependency stays one-way.
function readManifestLink(assetDirAbs: string): { assetId: string; taskId: string | null } | null {
  try {
    const raw = JSON.parse(readFileSync(join(assetDirAbs, 'manifest.json'), 'utf-8')) as Record<string, unknown>
    if (typeof raw?.assetId !== 'string') return null
    return { assetId: raw.assetId, taskId: typeof raw.taskId === 'string' ? raw.taskId : null }
  } catch {
    return null
  }
}

function buildIndex(): void {
  taskToAssets.clear()
  assetToTask.clear()
  const storeRoot = join(getContentDir(), 'assets', 'store')
  if (existsSync(storeRoot)) {
    for (const month of readdirSync(storeRoot)) {
      if (month.startsWith('.')) continue
      const monthDir = join(storeRoot, month)
      let entries: string[]
      try {
        if (!statSync(monthDir).isDirectory()) continue
        entries = readdirSync(monthDir)
      } catch {
        continue
      }
      for (const assetId of entries) {
        if (assetId.startsWith('.')) continue
        const link = readManifestLink(join(monthDir, assetId))
        if (link) upsert(link.assetId, link.taskId)
      }
    }
  }
  built = true
}

/** Asset ids linked to a task. Builds the index (one store scan) on first use. */
export function listAssetIdsByTask(taskId: string): string[] {
  if (!built) buildIndex()
  return [...(taskToAssets.get(taskId) ?? [])]
}

/** @internal Test-only: drop all state so the next read rebuilds. */
export function __resetTaskAssetIndex(): void {
  taskToAssets.clear()
  assetToTask.clear()
  built = false
}
