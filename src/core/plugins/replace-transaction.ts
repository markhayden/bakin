/**
 * The ONE way a plugin directory under `~/.bakin/plugins/<id>/` changes.
 *
 * Install and every upgrade lane (local re-copy, github fast-forward, github
 * subpath staging clone, Whiskit artifact) run the same transaction:
 *
 *   backup → sentinel → place → build → bins → ledger → commit
 *
 * - **backup**: the existing directory (if any) is renamed aside to
 *   `.bakin-backup-<id>` — same filesystem, atomic, byte-preserving.
 * - **sentinel**: `.bakin-install.json` is written into the fresh target
 *   BEFORE any content lands. While it exists the loader ignores the dir,
 *   and it records everything recovery needs: whether a backup exists, the
 *   `~/.bakin/bin` binaries this operation created, and the ledger row as it
 *   was before the operation.
 * - **place / build / bins / ledger** are the caller's steps; bins ride
 *   the shared plugin-bin installer with `stage: 'bins'` progress.
 * - **commit**: sentinel removed, backup deleted.
 *
 * Any failure — and any interruption, via {@link restoreFromSentinel} at the
 * next boot — puts the previous state back byte for byte: created bins and
 * their markers are deleted (never a shared, pre-existing bin), the target is
 * removed, the backup is renamed back, and the ledger row is restored (or
 * removed again for a first install). Spec plugin-managed-binaries S4/S14.
 *
 * The caller holds the install lock; this module asserts it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { assertInstallLockHeld } from '@/core/install-core/install-lock'
import { installPluginBins, type PluginBinIdentity, type PluginBinInstall } from '@/core/agent-packages/bin-installer'
import { binTargetPath } from '@/core/plugins/bin-owners'
import type { InstallProgressFn } from '@/core/agent-packages/install-progress'
import { removeInstalledBy } from '@bakin/core/agent-packages/markers'
import type { BinRequirement } from '@bakin/core/plugins/bin-requirement'
import {
  PluginLockEntrySchema,
  addPlugin,
  readPluginLockfile,
  removePlugin,
  writePluginLockfile,
  type PluginLockEntry,
} from '@bakin/core/plugins/lockfile'

const log = createLogger('plugin-replace')

/** Present in a plugin dir ⇒ an install/upgrade is in flight or died mid-way; the loader must ignore the dir. */
export const INSTALL_SENTINEL = '.bakin-install.json'
/** `<pluginsRoot>/.bakin-backup-<id>` holds the previous directory for the duration of one operation. */
export const BACKUP_PREFIX = '.bakin-backup-'

export const ReplaceSentinelSchema = z.object({
  op: z.enum(['install', 'upgrade']),
  id: z.string().min(1),
  startedAt: z.string(),
  pid: z.number().int(),
  /** True when the previous directory was renamed aside to `.bakin-backup-<id>`; false on a first install. */
  backup: z.boolean(),
  /** Names of the `~/.bakin/bin` binaries THIS operation created — recovery deletes exactly these (paths resolve against the CURRENT home, so a moved home still recovers). */
  createdBins: z.array(z.string()),
  /** The ledger row before the operation; null when there was none. */
  ledgerBefore: PluginLockEntrySchema.nullable(),
})
export type ReplaceSentinel = z.infer<typeof ReplaceSentinelSchema>

export interface ReplacePluginDirArgs {
  id: string
  op: ReplaceSentinel['op']
  /**
   * Populate `targetDir` (it exists and holds only the sentinel).
   * `previousDir` is the backed-up prior install, or null on a first install —
   * the github fast-forward lane copies it in and merges on top.
   */
  place: (targetDir: string, previousDir: string | null) => void | Promise<void>
  /** Compile step for source installs; artifact lanes omit it. */
  build?: (targetDir: string) => Promise<void>
  bins: readonly BinRequirement[]
  binIdentity: PluginBinIdentity
  /** Write the ledger row (and any other post-content projection). Throwing rolls everything back. */
  ledger: (installedBins: PluginBinInstall[]) => void | Promise<void>
  progress?: InstallProgressFn
}

export interface ReplacePluginDirResult {
  targetDir: string
  installedBins: PluginBinInstall[]
}

export function pluginsRootDir(): string {
  return join(getContentDir(), 'plugins')
}

export function pluginBackupDir(pluginsRoot: string, id: string): string {
  return join(pluginsRoot, `${BACKUP_PREFIX}${id}`)
}

export function readSentinel(pluginDir: string): ReplaceSentinel | null {
  const path = join(pluginDir, INSTALL_SENTINEL)
  if (!existsSync(path)) return null
  try {
    return ReplaceSentinelSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
  } catch (err) {
    log.warn('Unreadable install sentinel — recovery will treat the directory as a failed operation', {
      path, error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

function writeSentinel(targetDir: string, sentinel: ReplaceSentinel): void {
  writeFileSync(join(targetDir, INSTALL_SENTINEL), JSON.stringify(sentinel, null, 2), 'utf-8')
}

/** Move every entry of `from` into the existing `to` (same filesystem renames) — for lanes that materialized a full dir elsewhere. */
export function moveContents(from: string, to: string): void {
  for (const name of readdirSync(from)) {
    renameSync(join(from, name), join(to, name))
  }
}

/**
 * Put the previous state back. THE rollback routine — the in-process failure
 * path and boot recovery both call it, so what a crash leaves behind is
 * exactly what a caught error leaves behind.
 */
export function restoreFromSentinel(pluginsRoot: string, id: string, sentinel: Pick<ReplaceSentinel, 'backup' | 'createdBins'> & { ledgerBefore?: PluginLockEntry | null }): void {
  const targetDir = join(pluginsRoot, id)
  const backupDir = pluginBackupDir(pluginsRoot, id)
  for (const name of sentinel.createdBins) {
    const target = binTargetPath(name)
    // Marker FIRST: `~/.bakin/bin/<name>` has no extension, so once the binary
    // is gone the sidecar helper reads the path as a directory and the marker
    // would be orphaned (Checkpoint B finding).
    try { removeInstalledBy(target) } catch (err) {
      log.warn('Could not remove bin marker during rollback', { target, error: err instanceof Error ? err.message : String(err) })
    }
    rmSync(target, { force: true })
  }
  rmSync(targetDir, { recursive: true, force: true })
  if (sentinel.backup && existsSync(backupDir)) {
    renameSync(backupDir, targetDir)
  }
  if (sentinel.ledgerBefore !== undefined) {
    const lock = readPluginLockfile()
    const current = lock.plugins[id]
    if (JSON.stringify(current ?? null) !== JSON.stringify(sentinel.ledgerBefore)) {
      writePluginLockfile(
        sentinel.ledgerBefore ? addPlugin(lock, id, sentinel.ledgerBefore) : removePlugin(lock, id),
      )
    }
  }
}

/**
 * Clear whatever a prior interrupted operation on THIS id left behind, so a
 * new operation never starts on top of a half-state. Idempotent; a no-op on a
 * clean tree. Returns true when something was recovered.
 *
 * States, by where the previous process died:
 *  - backup present, target missing  → died between the rename-aside and the
 *    sentinel write; nothing else changed: rename the backup back.
 *  - target carries a sentinel        → died anywhere before commit: full
 *    restore from the sentinel (backup, bins, ledger).
 *  - backup present, target committed → died between sentinel removal and
 *    backup deletion: the operation completed; drop the backup.
 */
export function recoverPluginDir(pluginsRoot: string, id: string): boolean {
  const targetDir = join(pluginsRoot, id)
  const backupDir = pluginBackupDir(pluginsRoot, id)
  const sentinelPath = join(targetDir, INSTALL_SENTINEL)

  if (existsSync(sentinelPath)) {
    const sentinel = readSentinel(targetDir)
    restoreFromSentinel(pluginsRoot, id, sentinel ?? { backup: existsSync(backupDir), createdBins: [] })
    log.warn('Recovered an interrupted plugin operation', { id, op: sentinel?.op ?? 'unknown', startedAt: sentinel?.startedAt })
    return true
  }
  if (existsSync(backupDir)) {
    if (existsSync(targetDir)) {
      rmSync(backupDir, { recursive: true, force: true })
      log.info('Dropped a backup left by a completed plugin operation', { id })
    } else {
      renameSync(backupDir, targetDir)
      log.warn('Restored a plugin directory from its backup', { id })
    }
    return true
  }
  return false
}

export async function replacePluginDir(args: ReplacePluginDirArgs): Promise<ReplacePluginDirResult> {
  assertInstallLockHeld('replacePluginDir')
  const { id, progress } = args
  const pluginsRoot = pluginsRootDir()
  mkdirSync(pluginsRoot, { recursive: true })
  recoverPluginDir(pluginsRoot, id)

  const targetDir = join(pluginsRoot, id)
  const backupDir = pluginBackupDir(pluginsRoot, id)
  const hadPrevious = existsSync(targetDir)
  if (hadPrevious) renameSync(targetDir, backupDir)

  const sentinel: ReplaceSentinel = {
    op: args.op,
    id,
    startedAt: new Date().toISOString(),
    pid: process.pid,
    backup: hadPrevious,
    createdBins: [],
    ledgerBefore: readPluginLockfile().plugins[id] ?? null,
  }
  mkdirSync(targetDir, { recursive: true })
  writeSentinel(targetDir, sentinel)

  try {
    progress?.({ stage: 'project', message: `Placing ${id} files…` })
    await args.place(targetDir, hadPrevious ? backupDir : null)
    if (args.build) {
      progress?.({ stage: 'project', message: `Building ${id}…` })
      await args.build(targetDir)
    }
    const installedBins = await installPluginBins(args.bins, args.binIdentity, {
      progress,
      // Durable as each bin lands: a crash or a later failure rolls back
      // exactly what THIS operation created — never a shared, pre-existing bin.
      onInstalled: (installed) => {
        if (installed.created) {
          sentinel.createdBins.push(installed.name)
          writeSentinel(targetDir, sentinel)
        }
      },
    })
    progress?.({ stage: 'finalize', message: `Recording ${id}…` })
    await args.ledger(installedBins)

    rmSync(join(targetDir, INSTALL_SENTINEL), { force: true })
    if (hadPrevious) rmSync(backupDir, { recursive: true, force: true })
    return { targetDir, installedBins }
  } catch (err) {
    restoreFromSentinel(pluginsRoot, id, sentinel)
    log.error(`Plugin ${args.op} failed — previous state restored`, err as Error, { id })
    throw err
  }
}
