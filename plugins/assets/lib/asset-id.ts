/**
 * Asset identity for the versioned (asset-as-directory) model.
 *
 * An `assetId` has the form `YYYYMMDD-{slug}-{id8}` (NO extension) and names a
 * directory under `assets/store/{YYYY-MM}/`. The `YYYYMMDD` prefix is the
 * storage shard key, derived by construction — no resolver, no map. The slug is
 * frozen at creation (it is an id, not a title; the manifest carries live meaning).
 */
import { slugify, generateId8 } from './filename-id'

const ASSET_ID_RE = /^(\d{4})(\d{2})(\d{2})-.+-[0-9a-f]{8}$/i

function datePrefix(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

/** Build a fresh assetId: `YYYYMMDD-{slug}-{id8}`. `id8` is generated if omitted. */
export function generateAssetId(slug: string, id8?: string): string {
  const cleanSlug = slugify(slug) || 'asset'
  return `${datePrefix()}-${cleanSlug}-${id8 ?? generateId8()}`
}

/** `YYYY-MM` shard for a valid assetId, or null. Validates the date components. */
export function yearMonthFromAssetId(assetId: string): string | null {
  const m = ASSET_ID_RE.exec(assetId)
  if (!m) return null
  const year = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const day = parseInt(m[3], 10)
  if (year < 1970 || year > 9999) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  return `${m[1]}-${m[2]}`
}

/** True when an external-supplied id is safe to resolve (no separators/traversal). */
export function isValidAssetId(assetId: string): boolean {
  return (
    assetId.length > 0 &&
    !assetId.includes('/') &&
    !assetId.includes('\\') &&
    !assetId.includes('..') &&
    yearMonthFromAssetId(assetId) !== null
  )
}

/**
 * Content-dir-relative directory path for an assetId, or null if invalid.
 * Rejects anything `isValidAssetId` rejects (separators / `..`) so an
 * externally-supplied id can never resolve a path outside the asset store —
 * this is the single chokepoint every service path-resolution flows through.
 */
export function assetDirRelPath(assetId: string): string | null {
  if (!isValidAssetId(assetId)) return null
  const ym = yearMonthFromAssetId(assetId)
  return ym ? `assets/store/${ym}/${assetId}` : null
}
