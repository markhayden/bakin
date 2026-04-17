/**
 * Filename identity generator.
 *
 * Under the filename-as-identity model, every primary asset filename is
 * globally unique across the entire assets tree. This module produces the
 * `YYYYMMDD-{slug}-{id8}.{ext}` convention and detects whether an existing
 * filename already conforms.
 */
import { randomBytes } from 'crypto'

/** 8-char hex suffix. 4 bytes = 2^32 distinct values — collision-free at single-user scale. */
export function generateId8(): string {
  return randomBytes(4).toString('hex')
}

export function slugify(text: string, maxLength = 60): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength)
    .replace(/-$/, '')
}

function datePrefix(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

function normalizeExt(ext: string): string {
  return (ext.startsWith('.') ? ext.slice(1) : ext).toLowerCase()
}

/**
 * Build a conventional filename: YYYYMMDD-{slug}-{id8}.{ext}.
 * If `id8` is omitted, one is generated.
 */
export function generateConventionalFilename(slug: string, ext: string, id8?: string): string {
  const cleanSlug = slugify(slug) || 'asset'
  const cleanExt = normalizeExt(ext)
  const suffix = id8 || generateId8()
  return `${datePrefix()}-${cleanSlug}-${suffix}.${cleanExt}`
}

/**
 * Detect whether a filename already conforms to the convention.
 * Checks for: 8-char hex suffix immediately before the extension.
 * Doesn't require the date prefix — manually-dropped files that were
 * later given an id8 suffix should not be re-suffixed on migration.
 */
const CONVENTIONAL_RE = /-[0-9a-f]{8}\.[^./]+$/i

export function isConventional(filename: string): boolean {
  return CONVENTIONAL_RE.test(filename)
}

/**
 * Extract the id8 suffix from a conformant filename, or null.
 * Used by resolver to pair variants with their primary.
 */
export function extractId8(filename: string): string | null {
  const m = filename.match(/-([0-9a-f]{8})\.[^./]+$/i)
  return m ? m[1].toLowerCase() : null
}

/**
 * Given a primary filename, produce the stem used for pairing variants/sidecar.
 * `20260416-hero-a1b2c3d4.png` → `20260416-hero-a1b2c3d4`
 */
export function primaryStem(filename: string): string {
  const dotIdx = filename.lastIndexOf('.')
  return dotIdx > 0 ? filename.substring(0, dotIdx) : filename
}
