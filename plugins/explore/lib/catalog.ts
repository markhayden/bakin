/**
 * Merged catalog: embedded (shipped in the binary) ⊕ cached remote (fetched
 * on explicit user refresh, cached under ~/.bakin/plugin-data/explore/).
 *
 * Merge rule: keyed by (kind, id); a cached remote entry wins EXCEPT for
 * builtin listings, which always come from the embedded catalog — a remote
 * catalog cannot mark things builtin or override builtin entries.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { loadUnifiedCatalog } from '../../../src/core/curated-catalog/load'
import { CatalogFileSchema, type CatalogEntry, type CatalogFile } from '../../../src/core/curated-catalog/schema'

export function remoteCachePath(): string {
  return join(getContentDir(), 'plugin-data', 'explore', 'catalog.json')
}

/** Read the cached remote catalog; invalid or missing cache → null. */
export function readCachedRemoteCatalog(): CatalogFile | null {
  const path = remoteCachePath()
  if (!existsSync(path)) return null
  try {
    const parsed = CatalogFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf-8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const entryKey = (entry: CatalogEntry): string => `${entry.kind}:${entry.id}`

export interface MergedCatalog {
  entries: CatalogEntry[]
  updatedAt: string
  remoteUpdatedAt: string | null
}

export function mergeCatalogs(embedded: CatalogFile, remote: CatalogFile | null): MergedCatalog {
  if (!remote) {
    return { entries: embedded.entries, updatedAt: embedded.updatedAt, remoteUpdatedAt: null }
  }
  const merged = new Map<string, CatalogEntry>()
  for (const entry of embedded.entries) merged.set(entryKey(entry), entry)
  for (const entry of remote.entries) {
    if (entry.builtin) continue
    const existing = merged.get(entryKey(entry))
    if (existing?.builtin) continue
    merged.set(entryKey(entry), entry)
  }
  return { entries: [...merged.values()], updatedAt: embedded.updatedAt, remoteUpdatedAt: remote.updatedAt }
}

export async function mergedCatalog(): Promise<MergedCatalog> {
  return mergeCatalogs(await loadUnifiedCatalog(), readCachedRemoteCatalog())
}
