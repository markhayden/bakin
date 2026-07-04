/**
 * Pure assetId validators — shape/date checks only, no filesystem knowledge.
 *
 * An `assetId` has the form `YYYYMMDD-{slug}-{id8}` (NO extension) and names a
 * directory in the asset store, sharded by its `YYYY-MM` prefix. These
 * validators are the single home for that shape: the assets plugin resolves
 * store paths through them, and any plugin handling externally-supplied ids
 * (e.g. images references) gates on them before calling `ctx.assets`.
 * Generation and path resolution stay in the assets plugin — this module is
 * deliberately pure so it can live on the published SDK surface.
 */

const ASSET_ID_RE = /^(\d{4})(\d{2})(\d{2})-.+-[0-9a-f]{8}$/i

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
