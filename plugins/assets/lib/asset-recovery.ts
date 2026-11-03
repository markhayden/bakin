/**
 * Asset recovery (self-healing PR1 slice 1.4a; re-homing rows 180–182) — the
 * engine behind `/assets/<id>?recover=1`. Health names a broken asset
 * directory; the operator chooses here between the three honest repairs,
 * or trash. Nothing is invented: a rebuilt manifest records only what the
 * files on disk prove (version numbers, sizes, mime types, mtimes).
 *
 * - `inspectAssetRecovery` — the facts the page shows: manifest status,
 *   every file on disk, which recorded versions and exports are present.
 * - `rebuildManifestFromFiles` — manifest missing/invalid: a fresh manifest
 *   from `v<N>.<ext>` files, newest current.
 * - `detachMissingVersions` — manifest valid, files gone: drop the versions
 *   and exports whose files are missing; current repointed at the newest
 *   remaining. Refused when nothing would remain.
 * - `restoreVersionFromExport` — a derived export becomes a new current
 *   version (the export is the best copy left of what was lost).
 * - `inspectAssetReferences` / `detachAssetReferences` — what still points
 *   at the asset (its own task through `manifest.taskId`; brands through the
 *   `brands.assetReferences` hook) and the operator's detach of both (spec
 *   §3.9). Tasks carry no asset field: the task link IS the manifest's.
 * - `moveStoreLocationAside` — a required store location (`store`, `inbox`,
 *   `.trash`) that exists as a FILE is renamed aside so the self-heal
 *   repair can create the directory (row 174's card choice).
 */
import { existsSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getContentDir } from '../../../src/core/content-dir'
import { assetDirAbs } from './asset-id'
import { withAssetLock } from './asset-lock'
import { emitAssetWritten } from './asset-events'
import { addVersion } from './asset-mutations'
import { ASSET_TYPES, getMimeType, type AssetType } from './constants'
import { AssetManifestSchema, MANIFEST_FILENAME, readManifest, writeManifestAtomic, type AssetManifest, type AssetVersion } from './manifest'

const VERSION_FILE_RE = /^v(\d+)\.(?!thumb\.)[a-z0-9]+$/i

export interface AssetRecoveryReport {
  assetId: string
  dirExists: boolean
  manifest:
    | { status: 'missing' }
    | { status: 'invalid'; reason: string }
    | { status: 'ok'; type: string; currentVersion: number; currentVersionPresent: boolean; taskId: string | null }
  /** Every regular file in the asset directory (recursive one level for exports/). */
  filesOnDisk: Array<{ name: string; size: number }>
  /** `v<N>.<ext>` files on disk, whatever the manifest says. */
  versionFiles: Array<{ version: number; file: string; size: number }>
  /** The manifest's versions and whether each file is present (empty without a valid manifest). */
  versions: Array<{ version: number; file: string; present: boolean }>
  /** The manifest's exports and whether each file is present. */
  exports: Array<{ name: string; file: string; fromVersion: number; present: boolean }>
}

function listFiles(dirAbs: string): Array<{ name: string; size: number }> {
  const out: Array<{ name: string; size: number }> = []
  for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
    if (entry.isFile()) {
      out.push({ name: entry.name, size: statSync(join(dirAbs, entry.name)).size })
    } else if (entry.isDirectory()) {
      for (const nested of readdirSync(join(dirAbs, entry.name), { withFileTypes: true })) {
        if (nested.isFile()) out.push({ name: `${entry.name}/${nested.name}`, size: statSync(join(dirAbs, entry.name, nested.name)).size })
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function versionFilesOf(files: Array<{ name: string; size: number }>): Array<{ version: number; file: string; size: number }> {
  return files
    .flatMap((file) => {
      const match = VERSION_FILE_RE.exec(file.name)
      return match ? [{ version: Number(match[1]), file: file.name, size: file.size }] : []
    })
    .sort((a, b) => a.version - b.version)
}

function manifestStatus(dirAbs: string): AssetRecoveryReport['manifest'] {
  const path = join(dirAbs, MANIFEST_FILENAME)
  if (!existsSync(path)) return { status: 'missing' }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    return { status: 'invalid', reason: `not JSON: ${err instanceof Error ? err.message : String(err)}` }
  }
  const parsed = AssetManifestSchema.safeParse(raw)
  if (!parsed.success) {
    return { status: 'invalid', reason: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ').slice(0, 500) }
  }
  const manifest = parsed.data
  return {
    status: 'ok',
    type: manifest.type,
    currentVersion: manifest.currentVersion,
    currentVersionPresent: manifest.versions.some((v) => v.version === manifest.currentVersion && existsSync(join(dirAbs, v.file))),
    taskId: manifest.taskId,
  }
}

export function inspectAssetRecovery(assetId: string): AssetRecoveryReport {
  const dirAbs = assetDirAbs(assetId)
  const base: AssetRecoveryReport = { assetId, dirExists: false, manifest: { status: 'missing' }, filesOnDisk: [], versionFiles: [], versions: [], exports: [] }
  if (!dirAbs || !existsSync(dirAbs) || !statSync(dirAbs).isDirectory()) return base
  const filesOnDisk = listFiles(dirAbs)
  const manifest = manifestStatus(dirAbs)
  const parsed = manifest.status === 'ok' ? readManifest(dirAbs) : null
  return {
    assetId,
    dirExists: true,
    manifest,
    filesOnDisk,
    versionFiles: versionFilesOf(filesOnDisk),
    versions: parsed ? parsed.versions.map((v) => ({ version: v.version, file: v.file, present: existsSync(join(dirAbs, v.file)) })) : [],
    exports: parsed ? parsed.exports.map((e) => ({ name: e.name, file: e.file, fromVersion: e.fromVersion, present: existsSync(join(dirAbs, e.file)) })) : [],
  }
}

/** The asset type the files prove — by mime family; `other` when nothing is certain. */
function typeFromMime(mime: string): AssetType {
  const [family] = mime.split('/')
  if (mime === 'application/pdf') return 'pdf'
  const byFamily: Record<string, AssetType> = { image: 'images', video: 'video', audio: 'audio', text: 'text' }
  const type = byFamily[family ?? '']
  return type && (ASSET_TYPES as readonly string[]).includes(type) ? type : 'other'
}

export async function rebuildManifestFromFiles(assetId: string): Promise<AssetManifest> {
  return withAssetLock(assetId, async () => {
    const dirAbs = assetDirAbs(assetId)
    if (!dirAbs || !existsSync(dirAbs)) throw new Error(`Asset directory not found: ${assetId}`)
    if (manifestStatus(dirAbs).status === 'ok') throw new Error('The manifest is already valid — nothing to rebuild.')
    const files = versionFilesOf(listFiles(dirAbs))
    if (files.length === 0) throw new Error('The asset directory holds no version files (v<N>.<ext>) to rebuild a manifest from.')
    const versions: AssetVersion[] = files.map((file, index) => {
      const abs = join(dirAbs, file.file)
      const thumb = `v${file.version}.thumb.jpg`
      return {
        version: file.version,
        file: file.file,
        thumb: existsSync(join(dirAbs, thumb)) ? thumb : null,
        mimeType: getMimeType(file.file),
        size: file.size,
        width: null,
        height: null,
        created: statSync(abs).mtime.toISOString(),
        description: '',
        op: 'import',
        parentVersion: index > 0 ? files[index - 1]!.version : null,
        tool: null,
        prompt: null,
        promptHash: null,
        generation: null,
      }
    })
    const newest = versions[versions.length - 1]!
    const now = new Date().toISOString()
    const manifest: AssetManifest = {
      assetId,
      type: typeFromMime(newest.mimeType),
      source: { kind: 'import', path: null },
      agent: 'system',
      taskId: null,
      created: versions[0]!.created,
      updated: now,
      currentVersion: newest.version,
      description: '',
      tags: [],
      versions,
      exports: [],
    }
    writeManifestAtomic(dirAbs, manifest)
    emitAssetWritten({ assetId, version: newest.version, op: 'upsert' })
    return manifest
  })
}

export async function detachMissingVersions(assetId: string): Promise<{ manifest: AssetManifest; detachedVersions: number[]; detachedExports: string[] }> {
  return withAssetLock(assetId, async () => {
    const dirAbs = assetDirAbs(assetId)
    if (!dirAbs) throw new Error(`Invalid assetId: ${assetId}`)
    const manifest = readManifest(dirAbs)
    if (!manifest) throw new Error('The manifest is missing or invalid — rebuild it first.')
    const present = manifest.versions.filter((v) => existsSync(join(dirAbs, v.file)))
    if (present.length === 0) throw new Error('No version file remains on disk — there is nothing to keep; move the asset to the trash instead.')
    const detachedVersions = manifest.versions.filter((v) => !present.includes(v)).map((v) => v.version)
    const detachedExports = manifest.exports.filter((e) => !existsSync(join(dirAbs, e.file))).map((e) => e.name)
    if (detachedVersions.length === 0 && detachedExports.length === 0 && manifest.versions.some((v) => v.version === manifest.currentVersion)) {
      return { manifest, detachedVersions, detachedExports }
    }
    manifest.versions = present
    manifest.exports = manifest.exports.filter((e) => !detachedExports.includes(e.name))
    if (!present.some((v) => v.version === manifest.currentVersion)) {
      manifest.currentVersion = Math.max(...present.map((v) => v.version))
    }
    const current = present.find((v) => v.version === manifest.currentVersion)
    if (current) manifest.description = current.description
    manifest.updated = new Date().toISOString()
    writeManifestAtomic(dirAbs, manifest)
    emitAssetWritten({ assetId, version: manifest.currentVersion, op: 'upsert' })
    return { manifest, detachedVersions, detachedExports }
  })
}

/** The slice of a plugin/route context the usage facts need — tasks for the manifest's task, hooks for the brands. */
export interface AssetUsageContext {
  tasks?: { get(id: string): Promise<{ id: string; title?: string; column: string } | null> }
  hooks: { has(name: string): boolean; invoke<R>(name: string, data: unknown): Promise<R | undefined> }
}

/** Task columns whose task still uses its assets (done/archived history is not usage). */
export const OPEN_TASK_COLUMNS: ReadonlySet<string> = new Set(['backlog', 'todo', 'inProgress', 'review', 'blocked'])

export interface AssetReferences {
  /** False when a leg could not be read (task store or brands hook threw) — then nothing is claimed about that leg. */
  known: boolean
  /** The manifest's own task, and whether it is still open (null = could not be read). */
  task: { taskId: string; title: string | null; open: boolean | null } | null
  brands: Array<{ brandId: string; where: string }>
}

/** A reference is "in use" when its task is open or any brand still names it. */
export function referencesInUse(references: AssetReferences): boolean {
  return references.task?.open === true || references.brands.length > 0
}

/**
 * What still points at an asset. The task leg reads `manifest.taskId`
 * (tasks themselves carry no asset field); the brands leg asks the brands
 * plugin through its hook — absent plugin = no brands can reference it,
 * a throwing hook = unknown. Nothing is guessed: an unreadable leg leaves
 * `known: false` and claims nothing.
 */
export async function inspectAssetReferences(
  assetId: string,
  ctx: AssetUsageContext,
  manifestTaskId: string | null | undefined = undefined,
): Promise<AssetReferences> {
  let known = true
  let taskId = manifestTaskId
  if (taskId === undefined) {
    const dirAbs = assetDirAbs(assetId)
    const manifest = dirAbs ? readManifest(dirAbs) : null
    taskId = manifest ? manifest.taskId : null
    // A missing/invalid manifest has no readable task link: that leg is unknown, not "none".
    if (!manifest) known = false
  }
  let task: AssetReferences['task'] = null
  if (taskId) {
    try {
      const record = ctx.tasks ? await ctx.tasks.get(taskId) : null
      task = { taskId, title: record?.title ?? null, open: record ? OPEN_TASK_COLUMNS.has(record.column) : false }
    } catch {
      known = false
      task = { taskId, title: null, open: null }
    }
  }
  let brands: AssetReferences['brands'] = []
  if (ctx.hooks.has('brands.assetReferences')) {
    try {
      const answer = await ctx.hooks.invoke<{ byAsset?: Record<string, Array<{ brandId: string; where: string }>> }>('brands.assetReferences', { assetIds: [assetId] })
      brands = answer?.byAsset?.[assetId] ?? []
    } catch {
      known = false
    }
  }
  return { known, task, brands }
}

/**
 * The operator's "Detach references" (spec §3.9): the manifest forgets its
 * task (when it reads) and every brand drops the asset through
 * `brands.detachAsset`. Nothing on disk is deleted.
 */
export async function detachAssetReferences(assetId: string, ctx: AssetUsageContext): Promise<{ task: string | null; brands: string[] }> {
  return withAssetLock(assetId, async () => {
    const dirAbs = assetDirAbs(assetId)
    if (!dirAbs) throw new Error(`Invalid assetId: ${assetId}`)
    let task: string | null = null
    const manifest = readManifest(dirAbs)
    if (manifest?.taskId) {
      task = manifest.taskId
      manifest.taskId = null
      manifest.updated = new Date().toISOString()
      writeManifestAtomic(dirAbs, manifest)
      emitAssetWritten({ assetId, version: manifest.currentVersion, op: 'upsert' })
    }
    let brands: string[] = []
    if (ctx.hooks.has('brands.detachAsset')) {
      const answer = await ctx.hooks.invoke<{ detached?: string[] }>('brands.detachAsset', { assetId })
      brands = answer?.detached ?? []
    }
    return { task, brands }
  })
}

export const STORE_LOCATIONS = ['store', 'inbox', '.trash'] as const
export type StoreLocation = typeof STORE_LOCATIONS[number]

/**
 * Row 174: a required store location that exists as a FILE is renamed aside
 * (`<name>.invalid-<timestamp>`, same parent) so `repair-store` can create
 * the directory on its next self-heal pass. Nothing is deleted; a directory
 * is never touched.
 */
export function moveStoreLocationAside(location: StoreLocation, contentDir = getContentDir()): { movedTo: string } {
  const target = join(contentDir, 'assets', location)
  if (!existsSync(target)) throw new Error(`assets/${location} does not exist — nothing to move aside.`)
  if (statSync(target).isDirectory()) throw new Error(`assets/${location} is a directory — nothing to move aside.`)
  const movedTo = `${target}.invalid-${Date.now()}`
  renameSync(target, movedTo)
  return { movedTo }
}

export async function restoreVersionFromExport(assetId: string, exportName: string): Promise<{ assetId: string; version: number; manifest: AssetManifest }> {
  const dirAbs = assetDirAbs(assetId)
  if (!dirAbs) throw new Error(`Invalid assetId: ${assetId}`)
  const manifest = readManifest(dirAbs)
  if (!manifest) throw new Error('The manifest is missing or invalid — rebuild it first.')
  const found = manifest.exports.find((e) => e.name === exportName)
  if (!found) throw new Error(`There is no export named "${exportName}" on this asset.`)
  const sourceFilePath = join(dirAbs, found.file)
  if (!existsSync(sourceFilePath)) throw new Error(`The export "${exportName}" is itself missing from disk.`)
  return addVersion(assetId, {
    sourceFilePath,
    op: 'import',
    description: `Restored from export ${exportName} (v${found.fromVersion})`,
  })
}
