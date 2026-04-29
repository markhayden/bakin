/**
 * Path derivation for the filename-as-identity model.
 *
 * Canonical filenames have the form `YYYYMMDD-{slug}-{id8}.{ext}`. The
 * `YYYYMMDD` prefix is the storage shard key: an asset named
 * `20260401-hero-a1b2c3d4.png` always lives at
 * `assets/store/2026-04/20260401-hero-a1b2c3d4.png`.
 *
 * No in-memory map. No resolver. No watcher-dependent lookup. The filename
 * IS the path — by construction. Retype/relink are metadata-only because
 * changing `type` or `taskId` in the sidecar never moves the file.
 *
 * Non-canonical filenames (missing date prefix, malformed date) return
 * null. Every caller must null-check. The type system enforces this.
 */

const CANONICAL_RE = /^(\d{4})(\d{2})(\d{2})-.+\..+$/

/**
 * Returns the relative path (from the assets root) for a canonical filename,
 * or null if the name is non-canonical.
 *
 * Example:
 *   relPathForFilename('20260401-hero-a1b2c3d4.png')
 *   → 'store/2026-04/20260401-hero-a1b2c3d4.png'
 */
export function relPathForFilename(filename: string): string | null {
  const ym = yearMonthFromFilename(filename)
  if (!ym) return null
  return `store/${ym}/${filename}`
}

/**
 * Returns the content-dir-relative path (with the leading `assets/` prefix)
 * for a canonical filename, or null if the name is non-canonical.
 *
 * Example:
 *   pathForFilename('20260401-hero-a1b2c3d4.png')
 *   → 'assets/store/2026-04/20260401-hero-a1b2c3d4.png'
 *
 * This is what most callers want — they `join(getContentDir(), pathForFilename(fn))`
 * to get the absolute path on disk.
 */
export function pathForFilename(filename: string): string | null {
  const rel = relPathForFilename(filename)
  return rel ? `assets/${rel}` : null
}

/**
 * Returns the `YYYY-MM` shard key for a canonical filename, or null.
 * Exposed for callers that need to construct sidecar paths, parent dirs,
 * or month-scoped listings without building the full path.
 *
 * Example:
 *   yearMonthFromFilename('20260401-hero-a1b2c3d4.png') → '2026-04'
 */
export function yearMonthFromFilename(filename: string): string | null {
  const m = CANONICAL_RE.exec(filename)
  if (!m) return null
  const year = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const day = parseInt(m[3], 10)
  // Validate date components — don't just trust the regex.
  if (year < 1970 || year > 9999) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  return `${m[1]}-${m[2]}`
}

/**
 * True if `filename` matches the canonical form. Thin predicate for callers
 * that want to decide whether to run ingestion/canonicalization.
 */
export function isCanonicalFilename(filename: string): boolean {
  return yearMonthFromFilename(filename) !== null
}

/**
 * True when a caller-supplied filename is safe to resolve through
 * filename-as-identity. This is stricter than `isCanonicalFilename` because
 * external inputs must not carry path separators or traversal segments.
 */
export function isSafeCanonicalFilename(filename: string): boolean {
  return (
    filename.length > 0 &&
    !filename.includes('/') &&
    !filename.includes('\\') &&
    !filename.includes('..') &&
    isCanonicalFilename(filename)
  )
}
