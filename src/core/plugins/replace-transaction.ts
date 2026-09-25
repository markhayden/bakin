/**
 * The ONE way a plugin directory under `~/.bakin/plugins/<id>/` changes.
 *
 * Install and every upgrade lane (local re-copy, github fast-forward, github
 * subpath staging clone, Whiskit artifact) run the same transaction:
 *
 *   journal → backup → sentinel → place → build → bins → ledger → commit
 *
 * - **journal**: `.bakin-backup-<id>/journal.json` is written (atomically)
 *   BEFORE anything moves. It is the authority for recovery and records:
 *   whether the previous directory was renamed aside, the ledger row as it
 *   was, the binaries this operation intends to write (`intendedBins`), the
 *   binaries it replaced and backed up (`replacedBins`), and `committed`.
 * - **backup**: the existing directory (if any) is renamed to
 *   `.bakin-backup-<id>/plugin` — same filesystem, atomic, byte-preserving;
 *   a pre-existing target of any declared bin is copied to
 *   `.bakin-backup-<id>/bin/<name>` with its marker BEFORE the installer runs.
 * - **sentinel**: `.bakin-install.json` inside the target (a copy of the
 *   journal) exists only so the loader hides the directory while it is in
 *   flight; recovery reads the journal, never the sentinel, when both exist.
 * - **place / build / bins / ledger** are the caller's steps; bins ride the
 *   shared plugin-bin installer with `stage: 'bins'` progress.
 * - **commit**: journal rewritten with `committed: true` (the durable commit
 *   point), then the sentinel and the backup dir are removed.
 *
 * Any failure — and any interruption, via {@link restoreFromJournal} at the
 * next boot — puts the previous state back byte for byte: intended bins that
 * did not exist before are deleted (marker first), replaced bins and their
 * markers move back, the target is removed, the backup is renamed back, and
 * the ledger row is restored (or removed again for a first install). Because
 * the journal exists before the first rename and `committed` is written
 * before the backup is deleted, no on-disk state is ambiguous. Spec
 * plugin-managed-binaries S4/S14.
 *
 * The caller holds the install lock; this module asserts it.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { assertInstallLockHeld } from '@/core/install-core/install-lock'
import { installPluginBins, type PluginBinIdentity, type PluginBinInstall } from '@/core/agent-packages/bin-installer'
import { binTargetPath } from '@/core/plugins/bin-owners'
import type { InstallProgressFn } from '@/core/agent-packages/install-progress'
import { installedByPath, removeInstalledBy } from '@bakin/core/agent-packages/markers'
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
/** `<pluginsRoot>/.bakin-backup-<id>/` holds the journal, the previous directory and replaced binaries for one operation. */
export const BACKUP_PREFIX = '.bakin-backup-'
const JOURNAL_FILE = 'journal.json'

export const ReplaceJournalSchema = z.object({
  op: z.enum(['install', 'upgrade']),
  id: z.string().min(1),
  startedAt: z.string(),
  pid: z.number().int(),
  /** True when the previous directory was renamed aside to `.bakin-backup-<id>/plugin`; false on a first install. */
  backup: z.boolean(),
  /**
   * Names of declared binaries that did NOT exist before this operation —
   * journaled before the installer runs, so a crash between the binary
   * landing and its marker still rolls the file back. Paths resolve against
   * the CURRENT home, so a moved home still recovers.
   */
  intendedBins: z.array(z.string()),
  /** Names of binaries that existed before and were copied to `.bakin-backup-<id>/bin/` — rollback restores the OLD bytes and marker. */
  replacedBins: z.array(z.string()),
  /** The ledger row before the operation; null when there was none. */
  ledgerBefore: PluginLockEntrySchema.nullable(),
  /** The durable commit point: true once every step landed and only the sentinel/backup cleanup remains. */
  committed: z.boolean(),
})
export type ReplaceJournal = z.infer<typeof ReplaceJournalSchema>

export interface ReplacePluginDirArgs {
  id: string
  op: ReplaceJournal['op']
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
/** The previous plugin directory inside the backup. */
export const backupPluginDir = (backupDir: string): string => join(backupDir, 'plugin')
/** Previous bytes + marker of a binary this operation replaced. */
const backupBinPath = (backupDir: string, name: string): string => join(backupDir, 'bin', name)
export const journalPath = (backupDir: string): string => join(backupDir, JOURNAL_FILE)

function readJournalFile(path: string): ReplaceJournal | null {
  if (!existsSync(path)) return null
  try {
    return ReplaceJournalSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
  } catch (err) {
    log.warn('Unreadable install journal — recovery treats the operation as failed', {
      path, error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/** The authoritative journal of an operation on `id`, if one is on disk. */
export function readJournal(pluginsRoot: string, id: string): ReplaceJournal | null {
  return readJournalFile(journalPath(pluginBackupDir(pluginsRoot, id)))
}

/** The loader-visibility copy inside a plugin dir. */
export function readSentinel(pluginDir: string): ReplaceJournal | null {
  return readJournalFile(join(pluginDir, INSTALL_SENTINEL))
}

/** Atomic (tmp + rename): a crash mid-write never leaves a truncated journal. */
function writeJournalFile(path: string, journal: ReplaceJournal): void {
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(journal, null, 2), 'utf-8')
  renameSync(tmp, path)
}

function persist(backupDir: string, targetDir: string, journal: ReplaceJournal): void {
  writeJournalFile(journalPath(backupDir), journal)
  if (existsSync(targetDir)) writeJournalFile(join(targetDir, INSTALL_SENTINEL), journal)
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
export function restoreFromJournal(
  pluginsRoot: string,
  id: string,
  journal: Pick<ReplaceJournal, 'backup' | 'intendedBins' | 'replacedBins'> & { ledgerBefore?: PluginLockEntry | null },
): void {
  const targetDir = join(pluginsRoot, id)
  const backupDir = pluginBackupDir(pluginsRoot, id)
  const dropMarker = (target: string): void => {
    // Marker FIRST: `~/.bakin/bin/<name>` has no extension, so once the binary
    // is gone the sidecar helper reads the path as a directory and the marker
    // would be orphaned (Checkpoint B finding).
    try { removeInstalledBy(target) } catch (err) {
      log.warn('Could not remove bin marker during rollback', { target, error: err instanceof Error ? err.message : String(err) })
    }
  }
  for (const name of journal.intendedBins) {
    const target = binTargetPath(name)
    dropMarker(target)
    rmSync(target, { force: true })
  }
  for (const name of journal.replacedBins) {
    const saved = backupBinPath(backupDir, name)
    if (!existsSync(saved)) continue
    const target = binTargetPath(name)
    mkdirSync(dirname(target), { recursive: true })
    dropMarker(target)
    renameSync(saved, target)
    const savedMarker = installedByPath(saved)
    if (existsSync(savedMarker)) renameSync(savedMarker, installedByPath(target))
  }
  // `backup` is INTENT (a previous directory existed when the journal was
  // written); the rename-aside is COMPLETED only when `backup/plugin` exists.
  // A crash between writing the journal and renaming leaves the target as
  // the only copy of the previous install — it must not be removed.
  const renamedAside = journal.backup && existsSync(backupPluginDir(backupDir))
  if (renamedAside || !journal.backup) {
    rmSync(targetDir, { recursive: true, force: true })
    if (renamedAside) renameSync(backupPluginDir(backupDir), targetDir)
  } else {
    rmSync(join(targetDir, INSTALL_SENTINEL), { force: true })
  }
  rmSync(backupDir, { recursive: true, force: true })
  if (journal.ledgerBefore !== undefined) {
    const lock = readPluginLockfile()
    const current = lock.plugins[id]
    if (JSON.stringify(current ?? null) !== JSON.stringify(journal.ledgerBefore)) {
      writePluginLockfile(
        journal.ledgerBefore ? addPlugin(lock, id, journal.ledgerBefore) : removePlugin(lock, id),
      )
    }
  }
}

/**
 * Clear whatever a prior interrupted operation on THIS id left behind, so a
 * new operation never starts on top of a half-state. Idempotent; a no-op on a
 * clean tree. Returns true when something was recovered.
 *
 * The journal is written before the first rename and `committed` before the
 * backup is deleted, so every state is unambiguous:
 *  - backup dir with a committed journal → every step landed; drop the
 *    sentinel (if the crash beat its removal) and the backup dir.
 *  - backup dir with an in-flight (or unreadable) journal → died anywhere
 *    before commit — including between creating the empty target and
 *    writing its sentinel: full restore from the journal. When the journal
 *    intended a backup but `backup/plugin` does not exist, the rename never
 *    happened and the target IS the previous install: it stays.
 *  - target with a sentinel but no backup dir → a stray in-flight copy:
 *    restore from the sentinel.
 */
export function recoverPluginDir(pluginsRoot: string, id: string): boolean {
  const targetDir = join(pluginsRoot, id)
  const backupDir = pluginBackupDir(pluginsRoot, id)
  const sentinelPath = join(targetDir, INSTALL_SENTINEL)

  if (existsSync(backupDir)) {
    const journal = readJournal(pluginsRoot, id)
    if (journal?.committed) {
      rmSync(sentinelPath, { force: true })
      rmSync(backupDir, { recursive: true, force: true })
      log.info('Finished the cleanup of a committed plugin operation', { id, op: journal.op })
      return true
    }
    restoreFromJournal(pluginsRoot, id, journal ?? {
      backup: existsSync(backupPluginDir(backupDir)),
      intendedBins: [],
      replacedBins: [],
    })
    log.warn('Recovered an interrupted plugin operation', { id, op: journal?.op ?? 'unknown', startedAt: journal?.startedAt })
    return true
  }
  if (existsSync(sentinelPath)) {
    const sentinel = readSentinel(targetDir)
    restoreFromJournal(pluginsRoot, id, sentinel ?? { backup: false, intendedBins: [], replacedBins: [] })
    log.warn('Recovered a stray in-flight plugin directory', { id, op: sentinel?.op ?? 'unknown' })
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

  // Journal FIRST — before any rename — so recovery has an authority for
  // every later state, including "target created, sentinel not yet written".
  const journal: ReplaceJournal = {
    op: args.op,
    id,
    startedAt: new Date().toISOString(),
    pid: process.pid,
    backup: hadPrevious,
    intendedBins: [],
    replacedBins: [],
    ledgerBefore: readPluginLockfile().plugins[id] ?? null,
    committed: false,
  }
  mkdirSync(backupDir, { recursive: true })
  writeJournalFile(journalPath(backupDir), journal)
  if (hadPrevious) renameSync(targetDir, backupPluginDir(backupDir))
  mkdirSync(targetDir, { recursive: true })
  persist(backupDir, targetDir, journal)

  try {
    progress?.({ stage: 'project', message: `Placing ${id} files…` })
    await args.place(targetDir, hadPrevious ? backupPluginDir(backupDir) : null)
    if (args.build) {
      progress?.({ stage: 'project', message: `Building ${id}…` })
      await args.build(targetDir)
    }

    // Bin intent BEFORE any binary write: a declared bin that already exists
    // (a re-pin, or a shared bin whose marker the installer re-stamps) is
    // saved so rollback restores the OLD bytes and marker; one that does not
    // exist yet is journaled as intended so a crash between the installer's
    // rename and its marker write still rolls the file back.
    for (const bin of args.bins) {
      const target = binTargetPath(bin.name)
      if (existsSync(target)) {
        const saved = backupBinPath(backupDir, bin.name)
        mkdirSync(dirname(saved), { recursive: true })
        copyFileSync(target, saved)
        const marker = installedByPath(target)
        if (existsSync(marker)) copyFileSync(marker, installedByPath(saved))
        journal.replacedBins.push(bin.name)
      } else {
        journal.intendedBins.push(bin.name)
      }
    }
    persist(backupDir, targetDir, journal)
    const installedBins = await installPluginBins(args.bins, args.binIdentity, { progress })

    progress?.({ stage: 'finalize', message: `Recording ${id}…` })
    await args.ledger(installedBins)

    // Commit point: durable before any cleanup.
    journal.committed = true
    writeJournalFile(journalPath(backupDir), journal)
    rmSync(join(targetDir, INSTALL_SENTINEL), { force: true })
    rmSync(backupDir, { recursive: true, force: true })
    return { targetDir, installedBins }
  } catch (err) {
    restoreFromJournal(pluginsRoot, id, journal)
    log.error(`Plugin ${args.op} failed — previous state restored`, err as Error, { id })
    throw err
  }
}
