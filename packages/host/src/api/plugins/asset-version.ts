/**
 * The ONE resolver for a plugin's browser assets — used both to SERVE them
 * (`assets.ts`) and to VERSION them (`manifest.ts`), so a `?v=` key always
 * describes the bytes that URL returns. Order: user-installed disk →
 * embedded (compiled binary / generated map) → repo dist (dev fallback).
 *
 * Versions: a disk file's mtime (a plugin upgrade replaces the directory,
 * a rebuild rewrites the file); a compiled-in (`/$bunfs/`) file's content
 * hash (a rebuilt binary can keep its version string while its bytes
 * change, and `?v=` URLs are cached immutably).
 */
import { createHash } from 'crypto'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '@/core/content-dir'
import { EMBEDDED_ASSETS } from '../_embedded-assets'

export type PluginAsset =
  | { kind: 'disk'; path: string }
  | { kind: 'embedded'; path: string; key: string }

function diskFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

export async function resolvePluginAsset(pluginId: string, relPath: string): Promise<PluginAsset | null> {
  const userPath = join(getContentDir(), 'plugins', pluginId, 'dist', relPath)
  if (diskFile(userPath)) return { kind: 'disk', path: userPath }

  const key = `/api/plugins/${pluginId}/assets/${relPath}`
  const embeddedPath = EMBEDDED_ASSETS.get(key)
  if (embeddedPath) {
    // Only bytes compiled INTO the binary are immutable for the process; a
    // source run's map points at ordinary files a rebuild rewrites in place,
    // so those are disk assets (mtime-versioned), never memoized hashes.
    if (!embeddedPath.startsWith('/$bunfs/')) {
      if (diskFile(embeddedPath)) return { kind: 'disk', path: embeddedPath }
    } else {
      try {
        if (await Bun.file(embeddedPath).exists()) return { kind: 'embedded', path: embeddedPath, key }
      } catch {
        // fall through to the repo copy
      }
    }
  }

  const repoPath = join(process.cwd(), 'plugins', pluginId, 'dist', relPath)
  if (diskFile(repoPath)) return { kind: 'disk', path: repoPath }
  return null
}

const embeddedVersions = new Map<string, Promise<string>>()

function embeddedVersion(asset: { path: string; key: string }): Promise<string> {
  let version = embeddedVersions.get(asset.key)
  if (!version) {
    version = Bun.file(asset.path).arrayBuffer().then(
      (bytes) => `embedded-${createHash('sha256').update(new Uint8Array(bytes)).digest('hex').slice(0, 16)}`,
    )
    // A failed read must not poison the key for the life of the process.
    version.catch(() => { embeddedVersions.delete(asset.key) })
    embeddedVersions.set(asset.key, version)
  }
  return version
}

/** The cache key for a resolved asset, or null when it cannot be read. */
export async function assetVersion(asset: PluginAsset): Promise<string | null> {
  try {
    if (asset.kind === 'embedded') return await embeddedVersion(asset)
    return String(Math.trunc(statSync(asset.path).mtimeMs))
  } catch {
    return null
  }
}

export async function pluginAssetVersion(pluginId: string, relPath: string): Promise<string | null> {
  const asset = await resolvePluginAsset(pluginId, relPath)
  return asset ? assetVersion(asset) : null
}
