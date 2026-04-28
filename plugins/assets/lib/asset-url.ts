/**
 * Build a `file://` URL for an asset so the search adapter's media embedding
 * path can read the file directly from disk during multimodal indexing.
 * Bakin intentionally avoids loopback HTTP here; local file URLs are simpler,
 * don't require a server route, and keep the asset bytes under the content
 * directory contract.
 *
 * The caller passes a relative path under the assets root (e.g.
 * `store/2026-04/20260401-recipe-a1b2c3d4.pdf`) and gets back a
 * `file:///abs/path` URL.
 * The function also percent-encodes each path segment so filenames with
 * spaces or special characters round-trip correctly through adapter parsers.
 */
import { join } from 'path'
import { getBakinPaths } from '../../../src/core/content-dir'

export function buildAssetFileUrl(relPathUnderAssetsRoot: string): string {
  const clean = relPathUnderAssetsRoot.replace(/^[\\/]+/, '')
  const absolute = join(getBakinPaths().assets, clean)
  const encoded = absolute
    .split('/')
    .map((segment, i) => (i === 0 && segment === '' ? '' : encodeURIComponent(segment)))
    .join('/')
  return `file://${encoded}`
}
