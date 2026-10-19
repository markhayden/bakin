/**
 * Build a `file://` URL for an asset so the search adapter's media embedding
 * path can read the file directly from disk during multimodal indexing.
 * Bakin intentionally avoids loopback HTTP here; local file URLs are simpler,
 * don't require a server route, and keep the asset bytes under the content
 * directory contract.
 *
 * The caller passes a relative path under the assets root (e.g.
 * `store/2026-04/20260401-recipe-a1b2c3d4.pdf`) and gets back a
 * `file:///abs/path` URL — always absolute and canonical.
 * The function also percent-encodes each path segment so filenames with
 * spaces or special characters round-trip correctly through adapter parsers.
 */
import { realpathSync } from 'fs'
import { join, resolve } from 'path'
import { getBakinPaths } from '../../../src/core/content-dir'

/**
 * The assets root as ONE absolute, canonical path. A relative BAKIN_HOME
 * would otherwise yield `file://relative-home/…` (the engine reads that as a
 * hostname), and a symlinked home would spell the same file differently from
 * process to process — while the search engine only reads `file://` media
 * from an allowlisted store and checks the URL's path lexically first.
 */
function canonicalAssetsRoot(): string {
  const root = resolve(getBakinPaths().assets)
  try {
    return realpathSync(root)
  } catch (err) {
    // Not created yet: the absolute spelling is the best there is.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return root
    throw err
  }
}

export function buildAssetFileUrl(relPathUnderAssetsRoot: string): string {
  const clean = relPathUnderAssetsRoot.replace(/^[\\/]+/, '')
  const absolute = join(canonicalAssetsRoot(), clean)
  const encoded = absolute
    .split('/')
    .map((segment, i) => (i === 0 && segment === '' ? '' : encodeURIComponent(segment)))
    .join('/')
  return `file://${encoded}`
}
