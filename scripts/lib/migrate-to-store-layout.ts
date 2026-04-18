/**
 * One-shot migration: legacy `assets/{type}/{taskId|_unlinked|library}/{file}`
 * layout → `assets/store/{YYYY-MM}/{file}` with type + taskId persisted to the
 * sidecar instead of the path.
 *
 * Walks the legacy tree, canonicalizes non-conventional filenames, merges
 * path-derived metadata into the sidecar, then moves asset + sidecar to the
 * date-sharded store layout. Also moves `.trash/` to `store/.trash/`.
 *
 * Deleted in C8 — the layout it migrates out of no longer exists post-C7.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { ASSET_TYPES, SPECIAL_DIRS, type AssetType } from '../../plugins/assets/lib/constants'
import { extractId8, generateId8, slugify } from '../../plugins/assets/lib/filename-id'
import { isCanonicalFilename } from '../../plugins/assets/lib/path-for-filename'

export type MigrationLogger = (level: 'info' | 'warn' | 'error', msg: string, ctx?: Record<string, unknown>) => void

export interface MigrationOptions {
  assetsRoot: string
  dryRun: boolean
  log?: MigrationLogger
}

export interface MigrationResult {
  scanned: number
  moved: number
  renamed: number
  sidecarUpdated: number
  sidecarCreated: number
  orphanAssets: string[]
  orphanSidecars: string[]
  trashMoved: number
  emptyDirsRemoved: number
  errors: Array<{ path: string; error: string }>
}

interface LegacyRecord {
  type: AssetType
  taskId: string | null
  assetPath: string
  sidecarPath: string
  hasAsset: boolean
  hasSidecar: boolean
}

interface PlannedMove {
  record: LegacyRecord
  newFilename: string
  destDir: string
  destAsset: string
  destSidecar: string
  mergedSidecar: Record<string, unknown>
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

function formatYYYYMMDD(date: Date): string {
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`
}

function yearMonthFromDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`
}

function parseCreatedDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

function safeReadSidecar(sidecarPath: string): Record<string, unknown> | null {
  if (!existsSync(sidecarPath)) return null
  try {
    return JSON.parse(readFileSync(sidecarPath, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function safeStatMtime(p: string): Date | null {
  try {
    return statSync(p).mtime
  } catch {
    return null
  }
}

/**
 * Decide the canonical filename for a legacy file. Preserves an existing id8
 * suffix when present; prepends the YYYYMMDD prefix using (in order of
 * preference) the sidecar's `created` field or the file's mtime.
 */
export function canonicalizeFilename(
  origFilename: string,
  sidecarCreated: Date | null,
  fileMtime: Date | null,
): { filename: string; renamed: boolean } {
  if (isCanonicalFilename(origFilename)) {
    return { filename: origFilename, renamed: false }
  }

  const ext = extname(origFilename).slice(1).toLowerCase() || 'bin'
  const stem = basename(origFilename, extname(origFilename))
  const date = sidecarCreated ?? fileMtime ?? new Date()
  const dateStr = formatYYYYMMDD(date)

  const existingId = extractId8(origFilename)
  if (existingId) {
    const withoutIdExt = stem.slice(0, stem.length - `-${existingId}`.length)
    const slug = slugify(withoutIdExt) || 'asset'
    return { filename: `${dateStr}-${slug}-${existingId}.${ext}`, renamed: true }
  }

  const slug = slugify(stem) || 'asset'
  const id = generateId8()
  return { filename: `${dateStr}-${slug}-${id}.${ext}`, renamed: true }
}

function isLegacyTypeDir(name: string): boolean {
  return (ASSET_TYPES as readonly string[]).includes(name)
}

function isSpecialSubdir(name: string): boolean {
  return (SPECIAL_DIRS as readonly string[]).includes(name)
}

/**
 * Collect every asset + sidecar in the legacy layout. A record represents
 * either (asset + sidecar), (asset-only), or (sidecar-only) so the caller
 * can surface orphans.
 */
function collectLegacyRecords(assetsRoot: string, log: MigrationLogger): LegacyRecord[] {
  const records: LegacyRecord[] = []

  let topLevel: string[]
  try {
    topLevel = readdirSync(assetsRoot)
  } catch {
    return records
  }

  for (const typeName of topLevel) {
    if (!isLegacyTypeDir(typeName)) continue
    const typeDir = join(assetsRoot, typeName)
    try {
      if (!statSync(typeDir).isDirectory()) continue
    } catch { continue }

    let subdirs: string[]
    try { subdirs = readdirSync(typeDir) } catch { continue }

    for (const subdir of subdirs) {
      if (subdir.startsWith('.')) continue
      const subdirPath = join(typeDir, subdir)
      let isDir = false
      try { isDir = statSync(subdirPath).isDirectory() } catch { continue }
      if (!isDir) continue

      const taskId = isSpecialSubdir(subdir) ? null : subdir

      let files: string[]
      try { files = readdirSync(subdirPath) } catch { continue }

      const byBase = new Map<string, { asset?: string; sidecar?: string }>()
      for (const f of files) {
        if (f.startsWith('.')) continue
        const isSidecar = f.endsWith('.meta.json')
        const base = isSidecar ? f.slice(0, -'.meta.json'.length) : f
        const entry = byBase.get(base) ?? {}
        if (isSidecar) entry.sidecar = join(subdirPath, f)
        else entry.asset = join(subdirPath, f)
        byBase.set(base, entry)
      }

      for (const [base, entry] of byBase) {
        records.push({
          type: typeName as AssetType,
          taskId,
          assetPath: entry.asset ?? join(subdirPath, base),
          sidecarPath: entry.sidecar ?? join(subdirPath, `${base}.meta.json`),
          hasAsset: !!entry.asset,
          hasSidecar: !!entry.sidecar,
        })
      }
    }
  }

  log('info', 'Collected legacy records', { count: records.length })
  return records
}

/**
 * Plan every move before touching the filesystem. Returns the planned moves
 * plus any orphan paths (asset without sidecar, or sidecar without asset).
 * Filenames are canonicalized and checked for collisions against each other
 * and against anything already living under `store/`.
 */
function planMoves(
  assetsRoot: string,
  records: LegacyRecord[],
  log: MigrationLogger,
): { plans: PlannedMove[]; orphanAssets: string[]; orphanSidecars: string[]; errors: Array<{ path: string; error: string }> } {
  const plans: PlannedMove[] = []
  const orphanAssets: string[] = []
  const orphanSidecars: string[] = []
  const errors: Array<{ path: string; error: string }> = []
  const claimedFilenames = new Set<string>()

  const storeRoot = join(assetsRoot, 'store')

  for (const rec of records) {
    // Orphan sidecars are noted but not migrated — we'd have no file to pair them with.
    if (!rec.hasAsset && rec.hasSidecar) {
      orphanSidecars.push(rec.sidecarPath)
      continue
    }
    if (rec.hasAsset && !rec.hasSidecar) {
      orphanAssets.push(rec.assetPath)
      // Still migrate the asset — we'll synthesize a sidecar.
    }

    const origFilename = basename(rec.assetPath)
    const sidecar = rec.hasSidecar ? safeReadSidecar(rec.sidecarPath) : null
    const sidecarCreated = sidecar ? parseCreatedDate(sidecar.created) : null
    const mtime = safeStatMtime(rec.assetPath)

    let { filename: newFilename, renamed } = canonicalizeFilename(origFilename, sidecarCreated, mtime)

    // Avoid collisions within this migration batch and with pre-existing store files.
    let collision = 0
    while (
      claimedFilenames.has(newFilename)
      || existsSync(join(storeRoot, deriveMonth(newFilename), newFilename))
    ) {
      if (++collision > 8) {
        errors.push({ path: rec.assetPath, error: `Could not resolve filename collision for ${origFilename}` })
        break
      }
      const ext = extname(newFilename)
      const stem = basename(newFilename, ext)
      const lastDash = stem.lastIndexOf('-')
      const prefix = lastDash > 0 ? stem.slice(0, lastDash) : stem
      newFilename = `${prefix}-${generateId8()}${ext}`
      renamed = true
    }
    if (collision > 8) continue
    claimedFilenames.add(newFilename)

    const month = deriveMonth(newFilename)
    if (!month) {
      errors.push({ path: rec.assetPath, error: `Canonicalization produced non-canonical filename: ${newFilename}` })
      continue
    }

    const destDir = join(storeRoot, month)
    const destAsset = join(destDir, newFilename)
    const destSidecar = `${destAsset}.meta.json`

    const mergedSidecar: Record<string, unknown> = {
      ...(sidecar ?? {}),
      type: rec.type,
      taskId: rec.taskId,
    }
    if (!mergedSidecar.agent) mergedSidecar.agent = 'unknown'
    if (!mergedSidecar.created) {
      mergedSidecar.created = (mtime ?? new Date()).toISOString()
    }
    if (renamed && !mergedSidecar.originalFilename) {
      mergedSidecar.originalFilename = origFilename
    }

    plans.push({ record: rec, newFilename, destDir, destAsset, destSidecar, mergedSidecar })
    log('info', 'Planned move', { from: rec.assetPath, to: destAsset })
  }

  return { plans, orphanAssets, orphanSidecars, errors }
}

function deriveMonth(filename: string): string {
  const m = /^(\d{4})(\d{2})\d{2}-/.exec(filename)
  return m ? `${m[1]}-${m[2]}` : ''
}

/**
 * Move `assets/.trash/*` to `assets/store/.trash/*`. No filename change —
 * trash names encode the deletion timestamp, not the date prefix.
 */
function migrateTrash(assetsRoot: string, dryRun: boolean, log: MigrationLogger): { moved: number; errors: Array<{ path: string; error: string }> } {
  const src = join(assetsRoot, '.trash')
  if (!existsSync(src)) return { moved: 0, errors: [] }
  const dst = join(assetsRoot, 'store', '.trash')

  let entries: string[]
  try { entries = readdirSync(src) } catch { return { moved: 0, errors: [] } }

  const errors: Array<{ path: string; error: string }> = []
  let moved = 0

  if (!dryRun) mkdirSync(dst, { recursive: true })

  for (const name of entries) {
    if (name.startsWith('.')) continue
    const from = join(src, name)
    const to = join(dst, name)
    if (dryRun) {
      log('info', 'DRY-RUN trash move', { from, to })
      moved++
      continue
    }
    try {
      renameSync(from, to)
      moved++
    } catch (err) {
      errors.push({ path: from, error: err instanceof Error ? err.message : String(err) })
    }
  }

  if (!dryRun) {
    try { rmdirSync(src) } catch { /* may not be empty if errors occurred */ }
  }
  return { moved, errors }
}

/**
 * Remove empty `assets/{type}/{subdir}/` and `assets/{type}/` directories
 * left behind after migration. Stops at the first non-empty parent.
 */
function pruneEmptyLegacyDirs(assetsRoot: string, dryRun: boolean, log: MigrationLogger): number {
  let removed = 0

  const topLevel = (() => {
    try { return readdirSync(assetsRoot) } catch { return [] }
  })()

  for (const typeName of topLevel) {
    if (!isLegacyTypeDir(typeName)) continue
    const typeDir = join(assetsRoot, typeName)
    let subdirs: string[]
    try { subdirs = readdirSync(typeDir) } catch { continue }

    for (const sub of subdirs) {
      const subPath = join(typeDir, sub)
      try {
        if (!statSync(subPath).isDirectory()) continue
        const remaining = readdirSync(subPath)
        if (remaining.length === 0) {
          if (!dryRun) rmdirSync(subPath)
          removed++
          log('info', dryRun ? 'DRY-RUN remove empty subdir' : 'Removed empty subdir', { path: subPath })
        }
      } catch { /* skip */ }
    }

    try {
      const remaining = readdirSync(typeDir)
      if (remaining.length === 0) {
        if (!dryRun) rmdirSync(typeDir)
        removed++
        log('info', dryRun ? 'DRY-RUN remove empty type dir' : 'Removed empty type dir', { path: typeDir })
      }
    } catch { /* skip */ }
  }

  return removed
}

/**
 * Run the migration. Caller is responsible for backups; the script treats the
 * source tree as destructively convertible.
 */
export function migrateToStoreLayout(opts: MigrationOptions): MigrationResult {
  const log: MigrationLogger = opts.log ?? ((level, msg, ctx) => {
    const line = ctx ? `${msg} ${JSON.stringify(ctx)}` : msg
    if (level === 'error') console.error(line)
    else console.log(line)
  })

  const result: MigrationResult = {
    scanned: 0,
    moved: 0,
    renamed: 0,
    sidecarUpdated: 0,
    sidecarCreated: 0,
    orphanAssets: [],
    orphanSidecars: [],
    trashMoved: 0,
    emptyDirsRemoved: 0,
    errors: [],
  }

  if (!existsSync(opts.assetsRoot)) {
    log('warn', 'Assets root missing — nothing to migrate', { path: opts.assetsRoot })
    return result
  }

  const records = collectLegacyRecords(opts.assetsRoot, log)
  result.scanned = records.length

  const { plans, orphanAssets, orphanSidecars, errors } = planMoves(opts.assetsRoot, records, log)
  result.orphanAssets = orphanAssets
  result.orphanSidecars = orphanSidecars
  result.errors.push(...errors)

  for (const plan of plans) {
    const { record, newFilename, destDir, destAsset, destSidecar, mergedSidecar } = plan
    const origFilename = basename(record.assetPath)
    const renamed = newFilename !== origFilename

    if (opts.dryRun) {
      log('info', 'DRY-RUN move', { from: record.assetPath, to: destAsset, rename: renamed })
      result.moved++
      if (renamed) result.renamed++
      if (!record.hasSidecar) result.sidecarCreated++
      else result.sidecarUpdated++
      continue
    }

    try {
      mkdirSync(destDir, { recursive: true })
      if (record.hasAsset) {
        renameSync(record.assetPath, destAsset)
      }
      writeFileSync(destSidecar, JSON.stringify(mergedSidecar, null, 2))
      if (record.hasSidecar && record.sidecarPath !== destSidecar) {
        try { rmSync(record.sidecarPath, { force: true }) } catch { /* non-fatal */ }
      }
      result.moved++
      if (renamed) result.renamed++
      if (record.hasSidecar) result.sidecarUpdated++
      else result.sidecarCreated++
    } catch (err) {
      result.errors.push({ path: record.assetPath, error: err instanceof Error ? err.message : String(err) })
    }
  }

  const trash = migrateTrash(opts.assetsRoot, opts.dryRun, log)
  result.trashMoved = trash.moved
  result.errors.push(...trash.errors)

  result.emptyDirsRemoved = pruneEmptyLegacyDirs(opts.assetsRoot, opts.dryRun, log)

  return result
}
