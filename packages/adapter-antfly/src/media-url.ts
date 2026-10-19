/**
 * `file://` media and the engine's allowlist (0.2.5+, upstream #898).
 *
 * The engine reads `file://` media only from `remote_content.security
 * .allowed_paths`, checking the URL's path LEXICALLY against each entry before
 * opening the file, then the file's realpath against each entry's realpath.
 * Bakin allowlists the asset store and nothing else (`mediaRootsFor`), and
 * normalizes every `file://` value it sends to its canonical spelling when
 * that canonical path lies inside the store (`normalizeFileUrls`) — so a
 * document persisted under any spelling of the home (a symlink, a home spelled
 * differently before an upgrade, a store that is itself a symlink) still lands.
 */
import { realpathSync, statSync } from 'fs'
import { basename, dirname, join, resolve, sep } from 'path'
import { getBakinPaths } from '@bakin/core/content-dir'
import { createLogger } from '@bakin/core/logger'

const log = createLogger('antfly-media-url')

/**
 * Bun's realpath treats a backslash as a path separator, so a path containing
 * one can "resolve" to a DIFFERENT, unrelated path. Such paths are never
 * canonicalized — they keep their absolute spelling.
 */
const hasBackslash = (path: string) => path.includes('\\')

/** The deepest existing ancestor's realpath, with the missing tail re-attached. */
export function canonicalFilePath(path: string): string {
  const absolute = resolve(path)
  if (hasBackslash(absolute)) return absolute
  try {
    return realpathSync(absolute)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && (err as NodeJS.ErrnoException).code !== 'ENOTDIR') throw err
    const parent = dirname(absolute)
    if (parent === absolute) return absolute
    return join(canonicalFilePath(parent), basename(absolute))
  }
}

/**
 * The asset store, allowlisted under its own spelling AND its canonical one.
 * The as-given spelling passes the lexical check for URLs built from that
 * spelling; the canonical one covers everything `normalizeFileUrls` sends.
 */
export function mediaRootsFor(store: string): string[] {
  return [...new Set([resolve(store), canonicalFilePath(store)])]
}

/** This home's allowlisted media roots. */
export function localMediaRoots(): string[] {
  return mediaRootsFor(getBakinPaths()['assets.store'])
}

/** `file://` + each path segment percent-encoded — the asset URL builder's own shape. */
function encodeFileUrl(path: string): string {
  return `file://${path.split('/').map((segment, i) => (i === 0 && segment === '' ? '' : encodeURIComponent(segment))).join('/')}`
}

/**
 * The local path a `file://` URL names — ONLY for the exact shape Bakin's own
 * asset URL builder emits (`file:///` + non-empty segments, each exactly the
 * encodeURIComponent form of its decoded text). Anything else returns null
 * and is sent untouched: WHATWG parsing and path resolution both rewrite
 * spellings (dot segments, backslashes, trailing slashes, stripped whitespace
 * or NUL), and any of those can name a different file than the engine would.
 */
function localPathOf(url: string): string | null {
  if (!url.startsWith('file:///')) return null
  const segments = url.slice('file:///'.length).split('/')
  const decoded: string[] = []
  for (const segment of segments) {
    if (segment === '') return null
    let text: string
    try {
      text = decodeURIComponent(segment)
    } catch (err) {
      if (err instanceof URIError) return null
      throw err
    }
    // `/` inside a decoded segment (`%2F`) would let path resolution walk a
    // different route than the engine opening the original spelling.
    if (text === '.' || text === '..' || /[/\\\u0000-\u001f\u007f]/.test(text)) return null
    if (encodeURIComponent(text) !== segment) return null
    decoded.push(text)
  }
  return `/${decoded.join('/')}`
}

/** The realpath of an EXISTING regular file — null for anything else or anything unreadable. */
function existingFileRealpath(path: string, field: string): string | null {
  try {
    const canonical = realpathSync(path)
    return !hasBackslash(canonical) && statSync(canonical).isFile() ? canonical : null
  } catch (err) {
    log.debug('file:// value left as sent — its path could not be resolved', { field, error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/**
 * Rewrites each top-level `file://` string to its canonical spelling when it
 * has the builder's exact shape AND names an existing regular file whose
 * realpath lies inside one of `mediaRoots`. Everything else is sent exactly as
 * it is, and the engine's own check decides. Never throws for one value.
 */
export function normalizeFileUrls(doc: Record<string, unknown>, mediaRoots: readonly string[]): Record<string, unknown> {
  let next: Record<string, unknown> | null = null
  let roots: string[] | null = null
  for (const [field, value] of Object.entries(doc)) {
    if (typeof value !== 'string' || !value.startsWith('file://')) continue
    const path = localPathOf(value)
    if (path === null) continue
    const canonical = existingFileRealpath(path, field)
    if (canonical === null) continue
    roots ??= mediaRoots.flatMap((root) => {
      // A root that can't be canonicalized faithfully is never a rewrite target.
      if (hasBackslash(root)) return []
      try {
        const real = realpathSync(root)
        return hasBackslash(real) ? [] : [real]
      } catch (err) {
        log.debug('media root could not be resolved', { root, error: err instanceof Error ? err.message : String(err) })
        return []
      }
    })
    if (!roots.some((root) => canonical.startsWith(root + sep))) continue
    const url = encodeFileUrl(canonical)
    if (url === value || localPathOf(url) === null) continue
    next ??= { ...doc }
    next[field] = url
  }
  return next ?? doc
}
