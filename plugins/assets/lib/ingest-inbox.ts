/**
 * Inbox ingestion — the manual-drop flow.
 *
 * When a user drops a file into `~/.bakin/assets/inbox/`, this module:
 *   1. Parses the type hint from the subdir (e.g. `inbox/images/` → type=images).
 *      A drop in the inbox root gets type="other".
 *   2. Creates a managed versioned asset (v1) from the file via the asset service.
 *   3. Consumes (deletes) the inbox source file.
 *
 * The result is indistinguishable from an agent-driven save, so the rest of the
 * plugin (search, UI) treats inbox drops as first-class versioned assets.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { ASSET_TYPES, type AssetType } from './constants'
import { slugify } from './filename-id'
import { createAsset } from './asset-service'

export interface IngestResult {
  ok: boolean
  assetId?: string
  error?: string
}

const INBOX_PREFIX = 'assets/inbox/'

/**
 * Decide the type for an inbox file. Respects an explicit `inbox/{type}/`
 * subdir when present; falls back to "other" otherwise.
 */
function typeFromInboxPath(inboxRelPath: string): AssetType {
  const remainder = inboxRelPath.slice(INBOX_PREFIX.length)
  const firstSegment = remainder.split('/')[0]
  if (firstSegment && remainder.includes('/') && (ASSET_TYPES as readonly string[]).includes(firstSegment)) {
    return firstSegment as AssetType
  }
  return 'other'
}

/**
 * Ingest one file from the inbox into a managed versioned asset (v1).
 * `inboxRelPath` is content-dir-relative (e.g. `assets/inbox/images/my-pic.jpg`).
 */
export async function ingestInboxFile(inboxRelPath: string): Promise<IngestResult> {
  if (!inboxRelPath.startsWith(INBOX_PREFIX)) {
    return { ok: false, error: `Not an inbox path: ${inboxRelPath}` }
  }
  const name = basename(inboxRelPath)
  if (name.startsWith('.') || name.endsWith('.meta.json')) {
    return { ok: false, error: 'Not an ingestible file' }
  }

  const srcAbs = join(getContentDir(), inboxRelPath)
  if (!existsSync(srcAbs)) {
    return { ok: false, error: `Source file not found: ${inboxRelPath}` }
  }
  try {
    if (!statSync(srcAbs).isFile()) return { ok: false, error: 'Not a regular file' }
  } catch (err) {
    return { ok: false, error: `Failed to stat source: ${err instanceof Error ? err.message : String(err)}` }
  }

  const type = typeFromInboxPath(inboxRelPath)
  const slug = slugify(basename(name, extname(name))) || 'dropped'
  try {
    const { assetId } = await createAsset({
      sourceFilePath: srcAbs,
      type,
      agent: 'user',
      taskId: null,
      slug,
      op: 'upload',
      source: { kind: 'upload', path: null },
      description: name,
    })
    // createAsset copied the file into the asset dir — consume the inbox drop.
    try { rmSync(srcAbs, { force: true }) } catch { /* best-effort cleanup */ }
    return { ok: true, assetId }
  } catch (err) {
    return { ok: false, error: `Failed to ingest: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * Scan the inbox recursively and ingest every eligible file. Used on plugin
 * activation to catch drops that landed while the watcher wasn't running.
 */
export async function ingestInboxDir(): Promise<IngestResult[]> {
  const contentDir = getContentDir()
  const inboxRoot = join(contentDir, 'assets', 'inbox')
  if (!existsSync(inboxRoot)) return []

  const results: IngestResult[] = []
  const stack: string[] = [inboxRoot]
  while (stack.length > 0) {
    const dirAbs = stack.pop()!
    let entries: string[]
    try { entries = readdirSync(dirAbs) } catch { continue }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const entryAbs = join(dirAbs, entry)
      let isDir = false
      try { isDir = statSync(entryAbs).isDirectory() } catch { continue }
      if (isDir) { stack.push(entryAbs); continue }
      if (entry.endsWith('.meta.json')) continue
      results.push(await ingestInboxFile(entryAbs.slice(contentDir.length + 1)))
    }
  }
  return results
}
