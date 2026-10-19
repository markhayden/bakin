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
import { realpathSync } from 'fs'
import { fileURLToPath } from 'url'
import { basename, dirname, join, resolve, sep } from 'path'
import { getBakinPaths } from '@bakin/core/content-dir'

/** The deepest existing ancestor's realpath, with the missing tail re-attached. */
export function canonicalFilePath(path: string): string {
  const absolute = resolve(path)
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
 * Rewrites each top-level `file://` string to its canonical spelling when that
 * canonical path lies inside one of `mediaRoots` (canonicalized). Anything
 * else — outside the store, not a local file URL, undecodable — is sent as it
 * is, and the engine's own check decides.
 */
export function normalizeFileUrls(doc: Record<string, unknown>, mediaRoots: readonly string[]): Record<string, unknown> {
  let next: Record<string, unknown> | null = null
  const roots = [...new Set(mediaRoots.map(canonicalFilePath))]
  for (const [field, value] of Object.entries(doc)) {
    if (typeof value !== 'string' || !value.startsWith('file://')) continue
    let path: string
    try {
      path = fileURLToPath(value)
    } catch (err) {
      // A host-form URL (`file://relative-home/…`) is not a local path; the engine rejects it on its own.
      if (err instanceof TypeError) continue
      throw err
    }
    const canonical = canonicalFilePath(path)
    if (!roots.some((root) => canonical === root || canonical.startsWith(root + sep))) continue
    const url = encodeFileUrl(canonical)
    if (url === value) continue
    next ??= { ...doc }
    next[field] = url
  }
  return next ?? doc
}
