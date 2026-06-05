/**
 * Manifest read cache (#392) — stat-validated, never stale by construction.
 *
 * Entries are validated against one statSync of manifest.json on EVERY read:
 * token match (ino + size + mtimeMs) → cached manifest; mismatch → re-parse
 * and refill; stat failure → evict and return null. `writeManifestAtomic` is
 * temp-file + rename, so the inode changes on every write — the token
 * discriminates even same-millisecond writes, restored old timestamps, and
 * delete-recreate. No invalidation wiring exists or is needed: correctness is
 * checked against disk at read time, never maintained by discipline. Mutations
 * and `.trash/` reads bypass this module entirely (see asset-service).
 *
 * Token is captured BEFORE the read (stat → read → fill): a write landing
 * between the two leaves an old token on new content, costing one redundant
 * re-parse on the next read — never staleness. Entries are positive-only
 * (misses are not cached, so 404 probes insert nothing) and unbounded
 * (~KB per manifest; an LRU smaller than the store would thrash under
 * listAssets). Cached manifests are shared references — frozen under test so
 * any future consumer mutation throws in the suite instead of silently
 * corrupting reads in production.
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { readManifest, MANIFEST_FILENAME, type AssetManifest } from './manifest'

interface CacheEntry {
  ino: number
  size: number
  mtimeMs: number
  manifest: AssetManifest
}

const cache = new Map<string, CacheEntry>()

// Matches the logger's test detection: bun test sets NODE_ENV=test.
const FREEZE = process.env.NODE_ENV === 'test' || process.env.VITEST !== undefined

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
    Object.freeze(value)
  }
  return value
}

/**
 * Stat-validated read of an asset's manifest: cached when the on-disk token
 * matches, freshly parsed otherwise, null (and evicted) when missing/invalid.
 */
export function getManifestCached(assetId: string, assetDirAbs: string): AssetManifest | null {
  let st: { ino: number; size: number; mtimeMs: number }
  try {
    st = statSync(join(assetDirAbs, MANIFEST_FILENAME))
  } catch {
    cache.delete(assetId)
    return null
  }

  const hit = cache.get(assetId)
  if (hit && hit.ino === st.ino && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
    return hit.manifest
  }

  const manifest = readManifest(assetDirAbs)
  if (!manifest) {
    cache.delete(assetId)
    return null
  }
  if (FREEZE) deepFreeze(manifest)
  cache.set(assetId, { ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, manifest })
  return manifest
}

/** @internal Test-only: drop all entries. */
export function __resetManifestCache(): void {
  cache.clear()
}
