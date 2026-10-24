/**
 * Install-state join: catalog entries × local lockfiles × engine records.
 *
 * Lockfiles are the ground truth so GET /catalog stays offline-safe and
 * runtime-independent — no network I/O, no runtime adapter calls:
 *   - agents:  the installed packages (lock.json, canonical per id) with kind 'agent'
 *   - plugins: ~/.bakin/plugins/lock.json (+ builtin short-circuit)
 *   - packs:   the installed packages with another kind (hub provenance from the installed manifest)
 *
 * `updateAvailable` is the updates engine's observation for the installed
 * subject (#1007): `true` when it offers an unskipped update, `false` when
 * it observed the subject current (or blocked/unsupported), `null` when the
 * engine has no successful observation yet — unknown is never "up to date".
 */
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { isUpdateOffered, updateRecordMatchesInstalled, type UpdateRecord } from '@makinbakin/sdk/types'
import { isPluginDisabled, readPluginLockfile, type PluginLockEntry, type PluginLockfile } from '@bakin/core/plugins/lockfile'
import { getContentDir } from '../../../src/core/content-dir'
import { pluginInstalledIdentity } from '../../../src/core/updates/sources/plugin'
import { packageInstalledIdentity, type InstalledPackage } from '../../../src/core/updates/sources/package'
import { hubSkillInstalledIdentity } from '../../../src/core/updates/sources/hub-skill'
import { installedPackages } from '../../../src/core/updates/sources/package-wiring'
import type { CatalogEntry } from '../../../src/core/curated-catalog/schema'
import type { ExploreCatalogEntry } from '../types'

/** Engine records keyed by their id (`<kind>:<subjectId>`). */
export type UpdateRecordMap = ReadonlyMap<string, UpdateRecord>

export const NO_UPDATE_RECORDS: UpdateRecordMap = new Map()

export interface InstallStateSources {
  pluginLock: PluginLockfile
  /**
   * The installed agent packages and packs — ONE canonical entry per id with
   * its installed manifest's hub provenance (`installedPackages()`, the
   * same selection the updates engine's inventory makes).
   */
  packages: InstalledPackage[]
  /**
   * Plugin ids present on disk under ~/.bakin/plugins/. Pre-lockfile-era
   * installs (and seeded dev homes) have a directory but no lock entry —
   * same dual check onboarding's recommended-plugins uses.
   */
  installedPluginDirs: ReadonlySet<string>
  /** Core plugin id → manifest version (from the live plugin registry). */
  builtinVersions?: ReadonlyMap<string, string>
}

function scanInstalledPluginDirs(): Set<string> {
  const dir = join(getContentDir(), 'plugins')
  const found = new Set<string>()
  if (!existsSync(dir)) return found
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (existsSync(join(dir, entry.name, 'bakin-plugin.json'))) found.add(entry.name)
  }
  return found
}

function scanBuiltinVersions(): Map<string, string> {
  const versions = new Map<string, string>()
  try {
    // Lazy require keeps unit tests free of the registry's import graph.
    const { pluginRegistry, isCorePlugin } = require('../../../src/core/plugin-registry') as
      typeof import('../../../src/core/plugin-registry')
    for (const id of pluginRegistry.getPluginIds()) {
      if (!isCorePlugin(id)) continue
      const version = pluginRegistry.getPluginState(id)?.manifest?.version
      if (version) versions.set(id, version)
    }
  } catch {
    // Registry unavailable (unit tests, early boot) — versions stay unknown.
  }
  return versions
}

export function gatherInstallSources(): InstallStateSources {
  return {
    pluginLock: readPluginLockfile(),
    packages: installedPackages(),
    installedPluginDirs: scanInstalledPluginDirs(),
    builtinVersions: scanBuiltinVersions(),
  }
}

/** The canonical installed package (newest installed per id — the same selection the updates engine's inventory makes) owning this agent. */
function findAgentEntry(packages: readonly InstalledPackage[], agentId: string): InstalledPackage | null {
  return packages.find((candidate) => candidate.entry.kind === 'agent' && candidate.entry.agentId === agentId) ?? null
}

/** Pack lockfile keys are `id` or `id@version`; the canonical installed package for the id. */
function findPackEntry(packages: readonly InstalledPackage[], id: string, kind: CatalogEntry['kind']): InstalledPackage | null {
  return packages.find((candidate) => candidate.entry.kind === kind && candidate.id === id) ?? null
}

/** What the catalog says about an installed entry's update: the engine's record, kept whole enough that `blocked` is never "up to date". */
export type UpdateState = Pick<ExploreCatalogEntry, 'updateAvailable' | 'updateOutcome' | 'updateReason'>

export const UNKNOWN_UPDATE: UpdateState = { updateAvailable: null, updateOutcome: null }

/**
 * The engine's answer for one record: offered → true / `update-available`,
 * a skipped offer → false / `skipped`, observed current / blocked /
 * unsupported → false with the outcome (and the reason), no successful
 * observation (or no record at all) → null / null.
 */
export function updateStateOf(record: UpdateRecord | undefined): UpdateState {
  if (!record || record.outcome === 'unknown') return UNKNOWN_UPDATE
  if (record.outcome === 'update-available') {
    return isUpdateOffered(record) ? { updateAvailable: true, updateOutcome: 'update-available' } : { updateAvailable: false, updateOutcome: 'skipped' }
  }
  return {
    updateAvailable: false,
    updateOutcome: record.outcome,
    ...(record.blockedReason ? { updateReason: record.blockedReason } : {}),
  }
}

/** `updateAvailable` alone (tests and callers that only need the boolean). */
export function updateAvailableOf(record: UpdateRecord | undefined): boolean | null {
  return updateStateOf(record).updateAvailable
}

/**
 * A lockfile package is a `package` subject, or a `hub-skill` one when it
 * was synthesized from a hub bundle; a record observed for another installed
 * identity is no answer — compared against the identity the SOURCE names
 * (a hub skill's is the hub's resolved version, never the frontmatter one;
 * review r5 #6).
 */
function packageRecord(records: UpdateRecordMap, installed: InstalledPackage): UpdateRecord | undefined {
  const record = installed.upstream ? records.get(`hub-skill:${installed.id}`) : records.get(`package:${installed.id}`)
  if (!record) return undefined
  const identity = installed.upstream ? hubSkillInstalledIdentity(installed) : packageInstalledIdentity(installed.entry)
  return updateRecordMatchesInstalled(record, identity) ? record : undefined
}

/** A plugin record observed for another installed identity (a reinstall the engine has not reconciled yet) is no answer. */
function pluginRecord(records: UpdateRecordMap, id: string, installed: Pick<PluginLockEntry, 'type' | 'version' | 'commitSha' | 'sourceTreeSha'>): UpdateRecord | undefined {
  const record = records.get(`plugin:${id}`)
  if (!record) return undefined
  return updateRecordMatchesInstalled(record, pluginInstalledIdentity(installed)) ? record : undefined
}

export function joinInstallState(
  entries: readonly CatalogEntry[],
  sources: InstallStateSources,
  records: UpdateRecordMap = NO_UPDATE_RECORDS,
): ExploreCatalogEntry[] {
  return entries.map((entry) => {
    if (entry.builtin) {
      return {
        ...entry,
        installed: true,
        ...UNKNOWN_UPDATE,
        installedVersion: sources.builtinVersions?.get(entry.id) ?? null,
      }
    }

    if (entry.kind === 'agent') {
      const installed = findAgentEntry(sources.packages, entry.id)
      return {
        ...entry,
        installed: installed !== null,
        ...(installed ? updateStateOf(packageRecord(records, installed)) : UNKNOWN_UPDATE),
        installedVersion: installed?.entry.version ?? null,
      }
    }

    if (entry.kind === 'plugin') {
      const installed = sources.pluginLock.plugins[entry.id] ?? null
      return {
        ...entry,
        installed: installed !== null || sources.installedPluginDirs.has(entry.id),
        ...(installed ? updateStateOf(pluginRecord(records, entry.id, installed)) : UNKNOWN_UPDATE),
        installedVersion: installed?.version ?? null,
        ...(isPluginDisabled(installed) ? { disabled: true } : {}),
      }
    }

    const installed = findPackEntry(sources.packages, entry.id, entry.kind)
    return {
      ...entry,
      installed: installed !== null,
      ...(installed ? updateStateOf(packageRecord(records, installed)) : UNKNOWN_UPDATE),
      installedVersion: installed?.entry.version ?? null,
    }
  })
}
