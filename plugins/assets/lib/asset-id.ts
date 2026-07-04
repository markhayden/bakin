/**
 * Asset identity for the versioned (asset-as-directory) model.
 *
 * An `assetId` has the form `YYYYMMDD-{slug}-{id8}` (NO extension) and names a
 * directory under `assets/store/{YYYY-MM}/`. The `YYYYMMDD` prefix is the
 * storage shard key, derived by construction — no resolver, no map. The slug is
 * frozen at creation (it is an id, not a title; the manifest carries live meaning).
 */
import { join } from 'node:path'

import { isValidAssetId, yearMonthFromAssetId } from '@makinbakin/sdk/utils'

import { getContentDir } from '../../../src/core/content-dir'
import { slugify, generateId8 } from './filename-id'

// The pure shape validators are single-homed on the SDK surface
// (`@makinbakin/sdk/utils`) so other plugins (e.g. images) validate ids
// without importing this plugin. Re-exported here for plugin-internal
// consumers, which keep this module as their import surface.
export { isValidAssetId, yearMonthFromAssetId }

function datePrefix(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

/** Build a fresh assetId: `YYYYMMDD-{slug}-{id8}`. `id8` is generated if omitted. */
export function generateAssetId(slug: string, id8?: string): string {
  const cleanSlug = slugify(slug) || 'asset'
  return `${datePrefix()}-${cleanSlug}-${id8 ?? generateId8()}`
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

/** Absolute directory path for an assetId under the content dir, or null if invalid. */
export function assetDirAbs(assetId: string): string | null {
  const rel = assetDirRelPath(assetId)
  return rel ? join(getContentDir(), rel) : null
}
