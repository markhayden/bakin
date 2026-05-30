/**
 * Resolve an `/api/assets/...` request under the versioned (assetId) scheme.
 *
 * Path shapes:
 *   [assetId]                  → current version bytes
 *   [assetId, 'v', n]          → version n bytes
 *   [assetId, 'thumb']         → current thumbnail
 *   [assetId, 'v', n, 'thumb'] → version n thumbnail
 *   [assetId, 'export', name]  → export bytes
 *
 * The host serving route decides scheme purely from this result: a filename
 * (which carries an extension) is not a valid assetId, so `{ match: false }`
 * tells the host to fall back to the legacy filename scheme (removed in B8).
 */
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { getContentDir } from '../../../src/core/content-dir'
import { isValidAssetId, assetDirRelPath } from './asset-id'
import { getAsset, resolveFile } from './asset-service'
import type { AssetManifest } from './manifest'

export type AssetServeResult =
  | { match: false }
  | { match: true; found: false }
  | { match: true; found: true; absPath: string; mimeType: string; cacheKey: string }

const FORMAT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
}

function notFound(): AssetServeResult {
  return { match: true, found: false }
}

function thumbResult(manifest: AssetManifest, dirAbs: string, assetId: string, version: number): AssetServeResult {
  const ver = manifest.versions.find((v) => v.version === version)
  if (!ver?.thumb) return notFound()
  const absPath = join(dirAbs, ver.thumb)
  if (!existsSync(absPath)) return notFound()
  return { match: true, found: true, absPath, mimeType: 'image/jpeg', cacheKey: `${assetId}:v${version}:thumb` }
}

export function resolveAssetServe(segments: string[]): AssetServeResult {
  if (segments.length === 0 || !isValidAssetId(segments[0])) return { match: false }
  const assetId = segments[0]
  const rest = segments.slice(1)

  const manifest = getAsset(assetId)
  if (!manifest) return notFound()
  const dirAbs = join(getContentDir(), assetDirRelPath(assetId)!)

  // [assetId] → current
  if (rest.length === 0) {
    const ref = resolveFile(assetId)
    if (!ref) return notFound()
    return { match: true, found: true, absPath: ref.absPath, mimeType: ref.mimeType, cacheKey: `${assetId}:v${ref.version}` }
  }

  // [assetId, 'thumb']
  if (rest.length === 1 && rest[0] === 'thumb') {
    return thumbResult(manifest, dirAbs, assetId, manifest.currentVersion)
  }

  // [assetId, 'v', n] and [assetId, 'v', n, 'thumb']
  if (rest[0] === 'v' && rest[1] !== undefined) {
    const n = Number(rest[1])
    if (!Number.isInteger(n) || n < 1) return notFound()
    if (rest.length === 2) {
      const ref = resolveFile(assetId, n)
      if (!ref) return notFound()
      return { match: true, found: true, absPath: ref.absPath, mimeType: ref.mimeType, cacheKey: `${assetId}:v${n}` }
    }
    if (rest.length === 3 && rest[2] === 'thumb') {
      return thumbResult(manifest, dirAbs, assetId, n)
    }
    return notFound()
  }

  // [assetId, 'export', name]
  if (rest[0] === 'export' && rest.length === 2) {
    const exp = manifest.exports.find((e) => e.name === rest[1])
    if (!exp) return notFound()
    const absPath = join(dirAbs, exp.file)
    if (!existsSync(absPath)) return notFound()
    return {
      match: true,
      found: true,
      absPath,
      mimeType: FORMAT_MIME[exp.format] ?? 'application/octet-stream',
      cacheKey: `${assetId}:export:${exp.name}:v${exp.fromVersion}`,
    }
  }

  return notFound()
}
