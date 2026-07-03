/**
 * Explicit import of unmanaged files (spec D7) — the ONE rule: a raw file
 * on disk NEVER becomes an asset without an explicit import action (Import
 * tab, `bakin assets import`, or the MCP tool). This module replaced the
 * auto-ingesting inbox flow; `assets/inbox/` survives only as a convenient
 * drop location that the Import view surfaces like any other unmanaged file.
 *
 * Detection is deliberately cheap and never runs at boot: the live watcher
 * feeds the unmanaged tracker (no reads), and the full scan below runs only
 * on demand (Import view, doctor sweep). Scanning is readdir+stat only —
 * no file contents are ever read until the user imports.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { ASSET_TYPES, getAssetType, type AssetType } from './constants'
import { isValidAssetId } from './asset-id'
import { slugify } from './filename-id'
import { createAsset } from './asset-service'

export interface UnmanagedFile {
  relPath: string
  name: string
  size: number
  mtimeMs: number
  suggestedType: AssetType
}

export interface ImportResult {
  ok: boolean
  relPath: string
  assetId?: string
  error?: string
}

const MONTH_SHARD_RE = /^\d{4}-\d{2}$/

/**
 * A managed location is `assets/store/<YYYY-MM>/<validAssetId>/**` — the
 * versioned store the asset service owns. Everything else under `assets/`
 * that is a regular non-dot file is unmanaged (importable): inbox leftovers,
 * legacy flat files, user-created folders.
 */
export function isUnmanagedAssetPath(relPath: string): boolean {
  if (!relPath.startsWith('assets/')) return false
  const segments = relPath.split('/')
  if (segments.some(segment => segment === '.trash')) return false
  const name = segments[segments.length - 1]
  if (!name || name.startsWith('.') || name.endsWith('.meta.json')) return false
  if (segments[1] === 'store' && segments.length >= 4
    && MONTH_SHARD_RE.test(segments[2]) && isValidAssetId(segments[3])) {
    return false // inside a managed asset directory
  }
  return true
}

/**
 * Type suggestion: an explicit `inbox/<type>/` subdir wins (dropping into a
 * folder named after a type IS a signal), else the file extension decides.
 */
export function suggestTypeFor(relPath: string): AssetType {
  const segments = relPath.split('/')
  if (segments[1] === 'inbox' && segments.length > 3
    && (ASSET_TYPES as readonly string[]).includes(segments[2])) {
    return segments[2] as AssetType
  }
  return getAssetType(basename(relPath))
}

/**
 * On-demand scan for unmanaged files (Import view open, doctor sweep).
 * readdir + stat only; managed asset directories are skipped WHOLE (never
 * descended), so cost scales with unmanaged clutter, not store size.
 */
export function scanUnmanaged(): UnmanagedFile[] {
  const contentDir = getContentDir()
  const assetsRoot = join(contentDir, 'assets')
  if (!existsSync(assetsRoot)) return []

  const results: UnmanagedFile[] = []
  const stack: string[] = ['assets']
  while (stack.length > 0) {
    const relDir = stack.pop()!
    const absDir = join(contentDir, relDir)
    let entries: string[]
    try { entries = readdirSync(absDir) } catch { continue }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const rel = `${relDir}/${entry}`
      const abs = join(contentDir, rel)
      let stat
      try { stat = statSync(abs) } catch { continue }
      if (stat.isDirectory()) {
        const segments = rel.split('/')
        // Skip managed asset dirs whole; never descend into .trash.
        if (segments[1] === 'store' && segments.length === 4
          && MONTH_SHARD_RE.test(segments[2]) && isValidAssetId(segments[3])) continue
        if (entry === '.trash') continue
        stack.push(rel)
        continue
      }
      if (!stat.isFile()) continue
      if (!isUnmanagedAssetPath(rel)) continue
      results.push({
        relPath: rel,
        name: entry,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        suggestedType: suggestTypeFor(rel),
      })
    }
  }
  return results.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/**
 * Import one unmanaged file into a managed versioned asset (v1) and consume
 * the source. The manifest write re-enters the watcher → outbox → index
 * path, so the imported asset is searchable like any service-created one.
 */
export async function importUnmanagedFile(relPath: string, opts?: { type?: AssetType; taskId?: string | null }): Promise<ImportResult> {
  if (!isUnmanagedAssetPath(relPath)) {
    return { ok: false, relPath, error: `Not an unmanaged asset path: ${relPath}` }
  }
  const srcAbs = join(getContentDir(), relPath)
  if (!existsSync(srcAbs)) {
    return { ok: false, relPath, error: `Source file not found: ${relPath}` }
  }
  try {
    if (!statSync(srcAbs).isFile()) return { ok: false, relPath, error: 'Not a regular file' }
  } catch (err) {
    return { ok: false, relPath, error: `Failed to stat source: ${err instanceof Error ? err.message : String(err)}` }
  }

  const name = basename(relPath)
  const type = opts?.type ?? suggestTypeFor(relPath)
  const slug = slugify(basename(name, extname(name))) || 'imported'
  try {
    const { assetId } = await createAsset({
      sourceFilePath: srcAbs,
      type,
      agent: 'user',
      taskId: opts?.taskId ?? null,
      slug,
      op: 'import',
      source: { kind: 'import', path: relPath },
      description: name,
    })
    // createAsset copied the file into the asset dir — consume the source.
    try { rmSync(srcAbs, { force: true }) } catch { /* best-effort cleanup */ }
    return { ok: true, relPath, assetId }
  } catch (err) {
    return { ok: false, relPath, error: `Failed to import: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** Import every currently-unmanaged file (the "Import all" action). */
export async function importAllUnmanaged(opts?: { type?: AssetType }): Promise<ImportResult[]> {
  const results: ImportResult[] = []
  for (const file of scanUnmanaged()) {
    results.push(await importUnmanagedFile(file.relPath, opts?.type ? { type: opts.type } : undefined))
  }
  return results
}
