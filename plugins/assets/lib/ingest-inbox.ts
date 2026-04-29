/**
 * Inbox ingestion — the manual-drop flow.
 *
 * When a user drops a file into `~/.bakin/assets/inbox/`, this module:
 *   1. Parses the type hint from the subdir (e.g. `inbox/images/` → type=images).
 *      A drop in the inbox root gets type="other".
 *   2. Generates a canonical filename (YYYYMMDD-slug-id8.ext) derived from
 *      the source filename.
 *   3. Moves the file to `assets/store/{YYYY-MM}/{canonical-filename}`.
 *   4. Writes a stub sidecar colocated with the file, marking
 *      source="manual" and agent="user".
 *
 * The result is indistinguishable from an agent-driven save, so the rest
 * of the plugin (index, search, UI) treats inbox drops as first-class
 * assets without special-casing.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { ASSET_TYPES, type AssetType } from './constants'
import { generateConventionalFilename, slugify } from './filename-id'
import { pathForFilename, relPathForFilename, yearMonthFromFilename } from './path-for-filename'

export interface IngestResult {
  ok: boolean
  filename?: string
  path?: string
  error?: string
}

const INBOX_PREFIX = 'assets/inbox/'

/**
 * Decide the type for an inbox file. Respects an explicit `inbox/{type}/`
 * subdir when present; falls back to "other" otherwise. Only returns a
 * known AssetType — unknown subdirs are ignored (file treated as rootless
 * drop under "other").
 */
function typeFromInboxPath(inboxRelPath: string): AssetType {
  const remainder = inboxRelPath.slice(INBOX_PREFIX.length)
  const firstSegment = remainder.split('/')[0]
  if (firstSegment && remainder.includes('/') && (ASSET_TYPES as readonly string[]).includes(firstSegment)) {
    return firstSegment as AssetType
  }
  return 'other'
}

function generateUniqueFilename(slug: string, ext: string): string {
  const contentDir = getContentDir()
  for (let i = 0; i < 8; i++) {
    const candidate = generateConventionalFilename(slug, ext)
    const rel = pathForFilename(candidate)
    if (rel && !existsSync(join(contentDir, rel))) return candidate
  }
  throw new Error('Failed to generate unique filename after 8 retries')
}

/**
 * Ingest one file from the inbox. `inboxRelPath` is content-dir-relative
 * (e.g. `assets/inbox/images/my-pic.jpg`). Returns a result; callers are
 * responsible for auditing and indexing.
 */
export function ingestInboxFile(inboxRelPath: string): IngestResult {
  if (!inboxRelPath.startsWith(INBOX_PREFIX)) {
    return { ok: false, error: `Not an inbox path: ${inboxRelPath}` }
  }
  // Skip sidecars and dotfiles — they aren't user drops.
  const name = basename(inboxRelPath)
  if (name.startsWith('.') || name.endsWith('.meta.json')) {
    return { ok: false, error: 'Not an ingestible file' }
  }

  const contentDir = getContentDir()
  const srcAbs = join(contentDir, inboxRelPath)
  if (!existsSync(srcAbs)) {
    return { ok: false, error: `Source file not found: ${inboxRelPath}` }
  }
  try {
    if (!statSync(srcAbs).isFile()) return { ok: false, error: 'Not a regular file' }
  } catch (err) {
    return { ok: false, error: `Failed to stat source: ${err instanceof Error ? err.message : String(err)}` }
  }

  const type = typeFromInboxPath(inboxRelPath)
  const ext = extname(name).slice(1).toLowerCase() || 'bin'
  const slug = slugify(basename(name, extname(name))) || 'dropped'
  const filename = generateUniqueFilename(slug, ext)

  const relPath = relPathForFilename(filename)
  const yearMonth = yearMonthFromFilename(filename)
  if (!relPath || !yearMonth) {
    return { ok: false, error: `Generated non-canonical filename: ${filename}` }
  }

  const destDir = join(contentDir, 'assets', 'store', yearMonth)
  mkdirSync(destDir, { recursive: true })
  const destAbs = join(destDir, filename)

  try {
    renameSync(srcAbs, destAbs)
  } catch (err) {
    return { ok: false, error: `Failed to move file: ${err instanceof Error ? err.message : String(err)}` }
  }

  const sidecar = {
    agent: 'user',
    taskId: null,
    created: new Date().toISOString(),
    type,
    source: 'manual' as const,
    originalFilename: name,
  }
  writeFileSync(`${destAbs}.meta.json`, JSON.stringify(sidecar, null, 2))

  return { ok: true, filename, path: `assets/${relPath}` }
}

/**
 * Scan the inbox recursively and ingest every eligible file. Used on
 * plugin activation to catch drops that landed while the watcher wasn't
 * running. Returns the list of ingested results.
 */
export function ingestInboxDir(): IngestResult[] {
  const contentDir = getContentDir()
  const inboxRoot = join(contentDir, 'assets', 'inbox')
  if (!existsSync(inboxRoot)) return []

  const results: IngestResult[] = []

  function walk(dirAbs: string): void {
    let entries: string[]
    try { entries = readdirSync(dirAbs) } catch { return }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const entryAbs = join(dirAbs, entry)
      let isDir = false
      try { isDir = statSync(entryAbs).isDirectory() } catch { continue }
      if (isDir) {
        walk(entryAbs)
        continue
      }
      if (entry.endsWith('.meta.json')) continue
      const rel = entryAbs.slice(contentDir.length + 1)
      results.push(ingestInboxFile(rel))
    }
  }

  walk(inboxRoot)
  return results
}
