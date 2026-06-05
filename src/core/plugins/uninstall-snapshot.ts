/**
 * Pre-uninstall snapshot — captures everything Bakin will remove during
 * `bakin plugins remove` into a single tarball under
 * `~/.bakin/.uninstalled/<id>-<ISO>.tar.gz`.
 *
 * Captures only the Bakin-owned set: the plugin dir, the plugin-settings
 * JSON, and the runtime skills we're about to delete. Does NOT
 * capture data the plugin's own onUninstall removed — that's the plugin's
 * responsibility per the contract.
 *
 * Retention is intentionally conservative: keep the latest few snapshots
 * for each plugin and anything recent. This makes uninstall reversible
 * without letting `~/.bakin/.uninstalled/` grow forever.
 *
 * Atomic write: tar to `<final>.tmp-<pid>-<ts>`, rename on success.
 * Failure leaves the tmp file for debugging and surfaces the error.
 *
 * Tarball assembled via `Bun.spawn(['tar', '-czf', ...])` — both Linux
 * and macOS ship `tar`; no new npm dep (deliberate design decision;
 * see .claude/knowledge/plugin-lifecycle.md).
 */
import { createHash } from 'crypto'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { join, basename, dirname } from 'path'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { getAppServices } from '@/core/app-services'
import { findSkillsForPlugin } from '@/core/onboarding/plugin-assets'
import {
  addPlugin,
  PluginLockfileSchema,
  readPluginLockfile,
  writePluginLockfile,
  type PluginLockEntry,
} from '@bakin/core/plugins/lockfile'
import { readPluginManifestJson } from '@bakin/core/plugins/manifest'
import { parseManifestPermissions } from '@bakin/core/plugins/permissions'
import type { RuntimeSkill } from '@bakin/core/adapters/runtime'

const log = createLogger('uninstall-snapshot')
const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{0,39}$/
const SNAPSHOT_FILE_RE = /^([a-z][a-z0-9-]{0,39})-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.tar\.gz$/
const SAFE_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/
const DEFAULT_RETENTION = {
  keepPerPlugin: 5,
  maxAgeDays: 90,
}

export interface SnapshotInput {
  pluginId: string
  /** Absolute path to ~/.bakin/plugins/<id>/. */
  pluginDir: string
  /** Absolute path to ~/.bakin/plugin-settings/<id>.json. May not exist. */
  settingsFile?: string
  /** Lockfile entry removed after this snapshot. Captured so restore preserves provenance. */
  lockEntry?: PluginLockEntry
  /** Runtime skill content that will be removed. */
  removedSkills?: Array<{ name: string; files: Record<string, string> }>
  /** Legacy direct path snapshots; kept for tests and non-runtime callers. */
  removedSkillDirs?: string[]
}

export interface SnapshotResult {
  /** Final absolute path of the tarball under ~/.bakin/.uninstalled/. */
  tarballPath: string
  /** Absolute paths of files/dirs included in the tarball. */
  capturedPaths: string[]
}

export interface UninstallSnapshot {
  pluginId: string
  timestamp: string
  createdAt: string
  filename: string
  path: string
  sizeBytes: number
}

export interface UninstallSnapshotRetentionPolicy {
  /** Always keep this many newest snapshots per plugin, even if they are old. */
  keepPerPlugin?: number
  /** Always keep snapshots newer than this age, even beyond keepPerPlugin. */
  maxAgeDays?: number
  /** Test seam for deterministic retention. */
  now?: Date
}

export interface UninstallSnapshotRetentionReport {
  kept: UninstallSnapshot[]
  removed: UninstallSnapshot[]
  errors: Array<{ path: string; error: string }>
}

export interface RestoreInput {
  pluginId: string
  /**
   * Optional selector. Accepts the snapshot filename, the safe timestamp
   * token, or the ISO timestamp printed by listUninstallSnapshots.
   */
  snapshot?: string
  /** Replace existing plugin dir/settings/lockfile and runtime skills. */
  force?: boolean
}

export interface RestoreResult {
  pluginId: string
  snapshot: UninstallSnapshot
  pluginDir: string
  settingsFile?: string
  restoredSkills: string[]
  lockEntry: PluginLockEntry
}

export class PluginRestoreError extends Error {
  readonly status: number
  readonly code: 'invalid_plugin_id' | 'invalid_snapshot' | 'not_found' | 'conflict' | 'bad_snapshot'
  readonly snapshots: UninstallSnapshot[]

  constructor(input: {
    message: string
    status: number
    code: PluginRestoreError['code']
    snapshots?: UninstallSnapshot[]
  }) {
    super(input.message)
    this.name = 'PluginRestoreError'
    this.status = input.status
    this.code = input.code
    this.snapshots = input.snapshots ?? []
  }
}

/**
 * Build the tarball. Returns the final absolute path on success. Throws
 * on any failure (the caller should surface the error and decide whether
 * to skip cleanup or push through anyway).
 *
 * Implementation: copy each captured path into a staging dir laid out as
 * the desired tarball structure, then `tar -czf` the staging dir with
 * `-C <staging>` so entries inside the tarball land at clean relative
 * paths. Doubles the IO but keeps the on-disk layout inside the tarball
 * unambiguous (much simpler than wrangling tar `-C` for renamed entries
 * across heterogeneous source paths).
 */
export async function snapshotUninstall(input: SnapshotInput): Promise<SnapshotResult> {
  const uninstalledDir = join(getContentDir(), '.uninstalled')
  mkdirSync(uninstalledDir, { recursive: true, mode: 0o700 })
  // chmod after-the-fact in case the dir already existed at a looser mode.
  try {
    chmodSync(uninstalledDir, 0o700)
  } catch {
    // best-effort
  }

  // Sweep stale .tmp-* leftovers from previous failed snapshots so they
  // don't accumulate forever in this sensitive dir.
  cleanupStaleSnapshots(uninstalledDir)

  const isoSafe = new Date().toISOString().replace(/[:.]/g, '-')
  const finalPath = join(uninstalledDir, `${input.pluginId}-${isoSafe}.tar.gz`)
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`
  // mkdtempSync gives us a randomized + atomically-created dir, defeating
  // any TOCTOU symlink race on a predictable name.
  const stagingDir = mkdtempSync(`${finalPath}.tmp-${process.pid}-`)

  const captured: string[] = []
  try {
    if (existsSync(input.pluginDir)) {
      const dest = join(stagingDir, 'plugins', basename(input.pluginDir))
      mkdirSync(join(stagingDir, 'plugins'), { recursive: true })
      cpSync(input.pluginDir, dest, { recursive: true, dereference: false })
      captured.push(input.pluginDir)
    }

    if (input.settingsFile && existsSync(input.settingsFile)) {
      const dest = join(stagingDir, 'plugin-settings', basename(input.settingsFile))
      mkdirSync(join(stagingDir, 'plugin-settings'), { recursive: true })
      cpSync(input.settingsFile, dest)
      captured.push(input.settingsFile)
    }

    if (input.lockEntry) {
      const dest = join(stagingDir, 'plugin-lock', `${input.pluginId}.json`)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, JSON.stringify(input.lockEntry, null, 2) + '\n', 'utf-8')
      captured.push(`lockfile:plugins/${input.pluginId}`)
    }

    for (const skill of input.removedSkills ?? []) {
      const skillRoot = join(stagingDir, 'runtime-skills', skill.name)
      for (const [rel, content] of Object.entries(skill.files)) {
        if (!isSafeSnapshotRel(rel)) continue
        const dest = join(skillRoot, rel)
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, content, 'utf-8')
      }
      captured.push(`runtime:skills/${skill.name}`)
    }

    for (const dir of input.removedSkillDirs ?? []) {
      if (!existsSync(dir)) continue
      const dest = join(stagingDir, 'runtime-skills', basename(dir))
      mkdirSync(join(stagingDir, 'runtime-skills'), { recursive: true })
      cpSync(dir, dest, { recursive: true, dereference: false })
      captured.push(dir)
    }

    if (captured.length === 0) {
      // Nothing to archive — write an empty tarball anyway so the audit
      // trail still has a marker file at the final path.
      await spawnTar(['-czf', tmpPath, '-T', '/dev/null'])
    } else {
      // Tar the staging dir contents (not the staging dir itself) so the
      // tarball has clean top-level entries: plugins/, plugin-settings/,
      // runtime-skills/. `-C <staging>` enters the staging dir; `.` then
      // archives its contents.
      await spawnTar(['-czf', tmpPath, '-C', stagingDir, '.'])
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }

  try {
    renameSync(tmpPath, finalPath)
  } catch (err) {
    // Leave tmp for debugging — but try to surface a useful error.
    throw new Error(
      `snapshotUninstall: rename failed for ${tmpPath} → ${finalPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }
  // Tarball may contain plugin-settings JSON with secrets — restrict to
  // the owner only. Best-effort: never throw on chmod failure.
  try {
    chmodSync(finalPath, 0o600)
  } catch {
    // best-effort
  }

  log.info('plugin uninstall snapshot written', {
    pluginId: input.pluginId,
    tarball: finalPath,
    captured: captured.length,
  })
  try {
    const report = pruneUninstallSnapshots()
    if (report.removed.length > 0) {
      log.info('pruned uninstall snapshots by retention policy', {
        removed: report.removed.length,
        keepPerPlugin: DEFAULT_RETENTION.keepPerPlugin,
        maxAgeDays: DEFAULT_RETENTION.maxAgeDays,
      })
    }
  } catch (err) {
    log.warn('uninstall snapshot retention prune failed', { err: String(err) })
  }
  return { tarballPath: finalPath, capturedPaths: captured }
}

export function listUninstallSnapshots(pluginId?: string): UninstallSnapshot[] {
  const uninstalledDir = join(getContentDir(), '.uninstalled')
  if (!existsSync(uninstalledDir)) return []
  const snapshots: UninstallSnapshot[] = []
  for (const filename of readdirSync(uninstalledDir)) {
    const parsed = parseSnapshotFilename(filename)
    if (!parsed) continue
    if (pluginId && parsed.pluginId !== pluginId) continue
    const path = join(uninstalledDir, filename)
    try {
      const st = statSync(path)
      if (!st.isFile()) continue
      snapshots.push({
        ...parsed,
        filename,
        path,
        sizeBytes: st.size,
      })
    } catch {
      // best-effort listing; skip entries that disappear mid-scan
    }
  }
  return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function pruneUninstallSnapshots(
  policy: UninstallSnapshotRetentionPolicy = {},
): UninstallSnapshotRetentionReport {
  const keepPerPlugin = Math.max(1, Math.floor(policy.keepPerPlugin ?? DEFAULT_RETENTION.keepPerPlugin))
  const maxAgeDays = Math.max(0, Math.floor(policy.maxAgeDays ?? DEFAULT_RETENTION.maxAgeDays))
  const now = policy.now ?? new Date()
  const cutoffMs = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000
  const grouped = new Map<string, UninstallSnapshot[]>()
  for (const snapshot of listUninstallSnapshots()) {
    const arr = grouped.get(snapshot.pluginId) ?? []
    arr.push(snapshot)
    grouped.set(snapshot.pluginId, arr)
  }

  const kept: UninstallSnapshot[] = []
  const removed: UninstallSnapshot[] = []
  const errors: Array<{ path: string; error: string }> = []
  for (const snapshots of grouped.values()) {
    snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    snapshots.forEach((snapshot, index) => {
      const createdMs = Date.parse(snapshot.createdAt)
      const keepByCount = index < keepPerPlugin
      const keepByAge = Number.isFinite(createdMs) && createdMs >= cutoffMs
      if (keepByCount || keepByAge) {
        kept.push(snapshot)
        return
      }
      try {
        rmSync(snapshot.path, { force: true })
        removed.push(snapshot)
      } catch (err) {
        errors.push({
          path: snapshot.path,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })
  }
  return { kept, removed, errors }
}

export async function restoreUninstallSnapshot(input: RestoreInput): Promise<RestoreResult> {
  const pluginId = input.pluginId
  if (!PLUGIN_ID_RE.test(pluginId)) {
    throw new PluginRestoreError({
      status: 400,
      code: 'invalid_plugin_id',
      message: `Invalid pluginId "${pluginId}"`,
    })
  }
  if (input.snapshot !== undefined && !isSafeSnapshotSelector(input.snapshot)) {
    throw new PluginRestoreError({
      status: 400,
      code: 'invalid_snapshot',
      message: 'snapshot must be a filename or timestamp, not a path',
      snapshots: listUninstallSnapshots(pluginId),
    })
  }

  const snapshot = selectSnapshot(pluginId, input.snapshot)
  const contentDir = getContentDir()
  const pluginDir = join(contentDir, 'plugins', pluginId)
  const settingsFile = join(contentDir, 'plugin-settings', `${pluginId}.json`)
  const existingLock = readPluginLockfile()
  if (!input.force && (existsSync(pluginDir) || existingLock.plugins[pluginId])) {
    throw new PluginRestoreError({
      status: 409,
      code: 'conflict',
      message: `Plugin "${pluginId}" already exists. Remove it first or rerun restore with --force.`,
      snapshots: listUninstallSnapshots(pluginId),
    })
  }

  const uninstalledDir = join(contentDir, '.uninstalled')
  const stagingDir = mkdtempSync(join(uninstalledDir, `.restore-${pluginId}-`))
  try {
    validateTarListing(await spawnTarText(['-tzf', snapshot.path]), pluginId)
    await spawnTar(['-xzf', snapshot.path, '-C', stagingDir])

    const stagedPluginDir = join(stagingDir, 'plugins', pluginId)
    if (!existsSync(stagedPluginDir) || !lstatSync(stagedPluginDir).isDirectory()) {
      throw new PluginRestoreError({
        status: 400,
        code: 'bad_snapshot',
        message: `Snapshot ${snapshot.filename} does not contain plugins/${pluginId}/`,
        snapshots: listUninstallSnapshots(pluginId),
      })
    }

    const stagedSettingsFile = join(stagingDir, 'plugin-settings', `${pluginId}.json`)
    if (existsSync(stagedSettingsFile) && !lstatSync(stagedSettingsFile).isFile()) {
      throw new PluginRestoreError({
        status: 400,
        code: 'bad_snapshot',
        message: `Snapshot ${snapshot.filename} has an invalid plugin-settings/${pluginId}.json entry`,
        snapshots: listUninstallSnapshots(pluginId),
      })
    }

    const skillSnapshots = readRuntimeSkillSnapshots(stagingDir, pluginId)
    if (!input.force) {
      const runtime = getAppServices().runtime
      for (const skill of skillSnapshots) {
        const existingSkill = await runtime.skills.get(skill.name)
        if (existingSkill) {
          throw new PluginRestoreError({
            status: 409,
            code: 'conflict',
            message: `Runtime skill "${skill.name}" already exists. Restore with --force only if it is safe to overwrite it.`,
            snapshots: listUninstallSnapshots(pluginId),
          })
        }
      }
    }

    const lockEntry = readSnapshotLockEntry(stagingDir, pluginId)
      ?? synthesizeLockEntryFromSnapshot(stagedPluginDir, pluginId, pluginDir)
    let nextLock
    try {
      nextLock = PluginLockfileSchema.parse(addPlugin(readPluginLockfile(), pluginId, lockEntry))
    } catch (err) {
      throw new PluginRestoreError({
        status: 400,
        code: 'bad_snapshot',
        message: `Snapshot contains an invalid plugin lockfile entry: ${err instanceof Error ? err.message : String(err)}`,
        snapshots: listUninstallSnapshots(pluginId),
      })
    }

    if (input.force) {
      rmSync(pluginDir, { recursive: true, force: true })
      rmSync(settingsFile, { force: true })
    }
    mkdirSync(dirname(pluginDir), { recursive: true })
    cpSync(stagedPluginDir, pluginDir, { recursive: true, dereference: false })

    if (existsSync(stagedSettingsFile)) {
      mkdirSync(dirname(settingsFile), { recursive: true })
      cpSync(stagedSettingsFile, settingsFile)
    }

    const restoredSkills: string[] = []
    const runtime = getAppServices().runtime
    for (const skill of skillSnapshots) {
      await runtime.skills.write(skill)
      restoredSkills.push(skill.name)
    }

    writePluginLockfile(nextLock)

    log.info('plugin uninstall snapshot restored', {
      pluginId,
      snapshot: snapshot.path,
      skills: restoredSkills.length,
    })
    return {
      pluginId,
      snapshot,
      pluginDir,
      settingsFile: existsSync(settingsFile) ? settingsFile : undefined,
      restoredSkills,
      lockEntry,
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}

function isSafeSnapshotRel(path: string): boolean {
  return Boolean(path)
    && !path.startsWith('/')
    && !path.includes('\\')
    && !path.split('/').some((part) => part === '..' || part === '')
}

/**
 * Sweep stale `<id>-<ts>.tar.gz.tmp-*` leftovers that previous failed
 * runs left behind. Anything older than 24h goes; recent files are
 * preserved so a concurrent in-flight snapshot isn't disturbed.
 */
function cleanupStaleSnapshots(uninstalledDir: string): void {
  if (!existsSync(uninstalledDir)) return
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  let cleaned = 0
  try {
    for (const name of readdirSync(uninstalledDir)) {
      if (!name.includes('.tar.gz.tmp-')) continue
      const path = join(uninstalledDir, name)
      try {
        const st = statSync(path)
        if (st.mtimeMs < cutoff) {
          rmSync(path, { recursive: true, force: true })
          cleaned++
        }
      } catch {
        // best-effort per-entry
      }
    }
  } catch {
    // best-effort
  }
  if (cleaned > 0) {
    log.info('cleaned stale uninstall snapshots', { count: cleaned })
  }
}

function parseSnapshotFilename(filename: string): Omit<UninstallSnapshot, 'filename' | 'path' | 'sizeBytes'> | null {
  const match = SNAPSHOT_FILE_RE.exec(filename)
  if (!match) return null
  const timestamp = match[2]
  const createdAt = safeTimestampToIso(timestamp)
  if (!createdAt) return null
  return {
    pluginId: match[1],
    timestamp,
    createdAt,
  }
}

function safeTimestampToIso(timestamp: string): string | null {
  const match = SAFE_TIMESTAMP_RE.exec(timestamp)
  if (!match) return null
  const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`
  if (Number.isNaN(Date.parse(iso))) return null
  return iso
}

function isSafeSnapshotSelector(selector: string): boolean {
  return Boolean(selector)
    && !selector.startsWith('/')
    && !selector.includes('\\')
    && !selector.split('/').some(part => part === '..' || part === '')
}

function selectSnapshot(pluginId: string, selector?: string): UninstallSnapshot {
  const snapshots = listUninstallSnapshots(pluginId)
  if (snapshots.length === 0) {
    throw new PluginRestoreError({
      status: 404,
      code: 'not_found',
      message: `No uninstall snapshots found for plugin "${pluginId}".`,
      snapshots,
    })
  }
  if (!selector) return snapshots[0]
  const selected = snapshots.find(s =>
    s.filename === selector
    || s.timestamp === selector
    || s.createdAt === selector
    || basename(selector) === s.filename
  )
  if (!selected) {
    throw new PluginRestoreError({
      status: 404,
      code: 'not_found',
      message: `Snapshot "${selector}" was not found for plugin "${pluginId}".`,
      snapshots,
    })
  }
  return selected
}

function normalizeTarEntry(entry: string): string | null {
  const trimmed = entry.trim()
  if (!trimmed || trimmed === '.' || trimmed === './') return null
  return trimmed.startsWith('./') ? trimmed.slice(2) : trimmed
}

function validateTarListing(listing: string, pluginId: string): void {
  for (const raw of listing.split('\n')) {
    const entry = normalizeTarEntry(raw)
    if (!entry) continue
    if (entry.startsWith('/') || entry.includes('\\')) {
      throwBadSnapshot(`Snapshot contains unsafe absolute or Windows path: ${raw}`, pluginId)
    }
    const parts = entry.split('/').filter(Boolean)
    if (parts.some(part => part === '..' || part === '.')) {
      throwBadSnapshot(`Snapshot contains unsafe relative path: ${raw}`, pluginId)
    }
    const top = parts[0]
    if (!['plugins', 'plugin-settings', 'runtime-skills', 'plugin-lock'].includes(top)) {
      throwBadSnapshot(`Snapshot contains unsupported top-level entry: ${raw}`, pluginId)
    }
    if (top === 'plugins' && parts[1] && parts[1] !== pluginId) {
      throwBadSnapshot(`Snapshot contains a different plugin dir: ${raw}`, pluginId)
    }
    if ((top === 'plugin-settings' || top === 'plugin-lock') && parts[1] && parts[1] !== `${pluginId}.json`) {
      throwBadSnapshot(`Snapshot contains metadata for a different plugin: ${raw}`, pluginId)
    }
    if (top === 'runtime-skills' && parts[1] && !/^[A-Za-z0-9._-]+$/.test(parts[1])) {
      throwBadSnapshot(`Snapshot contains invalid runtime skill name: ${raw}`, pluginId)
    }
  }
}

function throwBadSnapshot(message: string, pluginId: string): never {
  throw new PluginRestoreError({
    status: 400,
    code: 'bad_snapshot',
    message,
    snapshots: listUninstallSnapshots(pluginId),
  })
}

function readRuntimeSkillSnapshots(stagingDir: string, pluginId: string): RuntimeSkill[] {
  const root = join(stagingDir, 'runtime-skills')
  if (!existsSync(root)) return []
  const skills: RuntimeSkill[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!/^[A-Za-z0-9._-]+$/.test(entry.name)) {
      throwBadSnapshot(`Snapshot contains invalid runtime skill name: ${entry.name}`, pluginId)
    }
    const sourceDir = join(root, entry.name)
    const files = readSnapshotTree(sourceDir)
    const instructions = files['SKILL.md'] ?? ''
    skills.push({
      name: entry.name,
      instructions,
      files,
      metadata: {
        installedBy: {
          pluginId,
          sha256: createHash('sha256').update(instructions).digest('hex'),
        },
      },
    })
  }
  return skills
}

function readSnapshotTree(root: string, prefix = ''): Record<string, string> {
  const files: Record<string, string> = {}
  const dir = join(root, prefix)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (!isSafeSnapshotRel(rel)) continue
    const abs = join(root, rel)
    if (entry.isDirectory()) {
      Object.assign(files, readSnapshotTree(root, rel))
    } else if (entry.isFile()) {
      files[rel] = readFileSync(abs, 'utf-8')
    }
  }
  return files
}

function readSnapshotLockEntry(stagingDir: string, pluginId: string): PluginLockEntry | null {
  const lockPath = join(stagingDir, 'plugin-lock', `${pluginId}.json`)
  if (!existsSync(lockPath)) return null
  try {
    return JSON.parse(readFileSync(lockPath, 'utf-8')) as PluginLockEntry
  } catch (err) {
    throwBadSnapshot(`Snapshot contains invalid plugin-lock/${pluginId}.json: ${err instanceof Error ? err.message : String(err)}`, pluginId)
  }
}

function synthesizeLockEntryFromSnapshot(
  stagedPluginDir: string,
  pluginId: string,
  restoredPluginDir: string,
): PluginLockEntry {
  const manifestPath = join(stagedPluginDir, 'bakin-plugin.json')
  const manifestText = readFileSync(manifestPath, 'utf-8')
  let manifest: ReturnType<typeof readPluginManifestJson>
  try {
    manifest = readPluginManifestJson(manifestText)
  } catch (err) {
    throw new PluginRestoreError({
      status: 400,
      code: 'bad_snapshot',
      message: `Snapshot contains an invalid plugins/${pluginId}/bakin-plugin.json: ${err instanceof Error ? err.message : String(err)}`,
      snapshots: listUninstallSnapshots(pluginId),
    })
  }
  if (manifest.id !== pluginId) {
    throw new PluginRestoreError({
      status: 400,
      code: 'bad_snapshot',
      message: `Snapshot manifest id "${manifest.id}" does not match requested plugin "${pluginId}".`,
      snapshots: listUninstallSnapshots(pluginId),
    })
  }
  return {
    source: restoredPluginDir,
    type: 'local',
    ref: '',
    commitSha: '',
    installedAt: new Date().toISOString(),
    version: manifest.version || '0.0.0',
    permissions: parseManifestPermissions(manifest.permissions),
    manifestSha: createHash('sha256').update(manifestText).digest('hex'),
    installedSkills: findSkillsForPlugin({ id: pluginId, path: stagedPluginDir }).map(s => s.name).sort(),
  }
}

async function spawnTar(args: string[]): Promise<void> {
  // Use Bun.spawn so we get a real subprocess; node's child_process would
  // also work but Bun's API is what the rest of this codebase reaches for.
  const proc = Bun.spawn(['tar', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const code = await proc.exited
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`tar exited with code ${code}: ${stderr.trim() || '(no stderr)'}`)
  }
}

async function spawnTarText(args: string[]): Promise<string> {
  const proc = Bun.spawn(['tar', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (code !== 0) {
    throw new Error(`tar exited with code ${code}: ${stderr.trim() || '(no stderr)'}`)
  }
  return stdout
}
