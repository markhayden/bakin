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
import { basename, dirname, join, resolve } from 'path'
import { getBakinPaths } from '../../../src/core/content-dir'

/**
 * One absolute, canonical spelling for a file: the deepest existing
 * ancestor's realpath with the missing tail re-attached. A relative
 * BAKIN_HOME would otherwise yield `file://relative-home/…` (the engine reads
 * that as a hostname), and a symlinked home — or a symlinked store under it —
 * would spell the same file differently from process to process, while the
 * search engine only reads `file://` media from an allowlisted store and
 * checks the URL's path lexically first.
 */
function canonicalFilePath(path: string): string {
  const absolute = resolve(path)
  try {
    return realpathSync(absolute)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err
    const parent = dirname(absolute)
    return parent === absolute ? absolute : join(canonicalFilePath(parent), basename(absolute))
  }
}

export function buildAssetFileUrl(relPathUnderAssetsRoot: string): string {
  const clean = relPathUnderAssetsRoot.replace(/^[\\/]+/, '')
  const absolute = canonicalFilePath(join(getBakinPaths().assets, clean))
  const encoded = absolute
    .split('/')
    .map((segment, i) => (i === 0 && segment === '' ? '' : encodeURIComponent(segment)))
    .join('/')
  return `file://${encoded}`
}
