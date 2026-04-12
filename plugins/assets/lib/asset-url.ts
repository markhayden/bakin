/**
 * Build a `file://` URL for an asset so Antfly's remotePDF / remoteMedia
 * template helpers can read the file directly from disk during multimodal
 * indexing. Previously this went through a loopback HTTP file server, but
 * Antfly's scraping layer hardcodes a block on private IPs (127.0.0.1)
 * for http:// URLs and provides no config path to disable it. `file://`
 * URLs skip the HTTP path entirely and have no private-IP check — they
 * only fail `validatePathSecurity` when AllowedPaths is configured, which
 * Bakin doesn't set.
 *
 * The caller passes a relative path under the assets root (e.g.
 * `other/task-1/recipe.pdf`) and gets back a `file:///abs/path` URL.
 * The function also percent-encodes each path segment so filenames with
 * spaces or special characters round-trip correctly through Antfly's
 * URL parser.
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
