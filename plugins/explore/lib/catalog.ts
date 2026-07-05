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
import { createLogger } from '../../../src/core/logger'
import { loadUnifiedCatalog } from '../../../src/core/curated-catalog/load'
import { CatalogFileSchema, type CatalogEntry, type CatalogFile } from '../../../src/core/curated-catalog/schema'
import { CORE_PLUGIN_IDS } from '../../../src/lib/core-plugin-ids'

const log = createLogger('explore')

export function remoteCachePath(): string {
  return join(getContentDir(), 'plugin-data', 'explore', 'catalog.json')
}

/** Read the cached remote catalog; invalid or missing cache → null (logged). */
export function readCachedRemoteCatalog(): CatalogFile | null {
  const path = remoteCachePath()
  if (!existsSync(path)) return null
  try {
    const parsed = CatalogFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf-8')))
    if (!parsed.success) {
      log.warn('cached remote catalog failed schema validation — ignoring cache', {
        path,
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      })
      return null
    }
    return parsed.data
  } catch (err) {
    log.warn('cached remote catalog unreadable — ignoring cache', {
      path,
      error: err instanceof Error ? err.message : String(err),
    })
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
  const corePluginIds = new Set(CORE_PLUGIN_IDS)
  const merged = new Map<string, CatalogEntry>()
  for (const entry of embedded.entries) merged.set(entryKey(entry), entry)
  for (const entry of remote.entries) {
    if (entry.builtin) continue
    // A remote catalog can never claim a core plugin id — even one the
    // embedded catalog forgot to list — or it would render an Install
    // button for something that ships in the binary.
    if (entry.kind === 'plugin' && corePluginIds.has(entry.id)) continue
    const existing = merged.get(entryKey(entry))
    if (existing?.builtin) continue
    merged.set(entryKey(entry), entry)
  }
  return { entries: [...merged.values()], updatedAt: embedded.updatedAt, remoteUpdatedAt: remote.updatedAt }
}

export async function mergedCatalog(): Promise<MergedCatalog> {
  return mergeCatalogs(await loadUnifiedCatalog(), readCachedRemoteCatalog())
}
