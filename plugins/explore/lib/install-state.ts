/**
 * Install-state join: catalog entries × local lockfiles × engine records.
 *
 * Lockfiles are the ground truth so GET /catalog stays offline-safe and
 * runtime-independent — no network I/O, no runtime adapter calls:
 *   - agents:  ~/.bakin/packages/lock.json entries with kind 'agent'
 *   - plugins: ~/.bakin/plugins/lock.json (+ builtin short-circuit)
 *   - packs:   ~/.bakin/packages/lock.json non-agent entries
 *
 * `updateAvailable` is the updates engine's observation for the installed
 * subject (#1007): `true` when it offers an unskipped update, `false` when
 * it observed the subject current (or blocked/unsupported), `null` when the
 * engine has no successful observation yet — unknown is never "up to date".
 */
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { isUpdateOffered, updateRecordMatchesInstalled, type UpdateRecord } from '@makinbakin/sdk/types'
import { readPluginLockfile, type PluginLockEntry, type PluginLockfile } from '@bakin/core/plugins/lockfile'
import { canonicalPackageEntries, readLockfile, type CanonicalPackageEntry, type Lockfile } from '@bakin/core/agent-packages/lockfile'
import { getContentDir } from '../../../src/core/content-dir'
import { pluginInstalledIdentity } from '../../../src/core/updates/sources/plugin'
import type { CatalogEntry } from '../../../src/core/curated-catalog/schema'
import type { ExploreCatalogEntry } from '../types'

/** Engine records keyed by their id (`<kind>:<subjectId>`). */
export type UpdateRecordMap = ReadonlyMap<string, UpdateRecord>

export const NO_UPDATE_RECORDS: UpdateRecordMap = new Map()

export interface InstallStateSources {
  pluginLock: PluginLockfile
  packageLock: Lockfile
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
    packageLock: readLockfile(),
    installedPluginDirs: scanInstalledPluginDirs(),
    builtinVersions: scanBuiltinVersions(),
  }
}

/** The canonical entry (newest installed per id — the same selection the updates engine's inventory makes) owning this agent. */
function findAgentEntry(lock: Lockfile, agentId: string): CanonicalPackageEntry | null {
  return canonicalPackageEntries(lock).find((candidate) => candidate.entry.kind === 'agent' && candidate.entry.agentId === agentId) ?? null
}

/** Pack lockfile keys are `id` or `id@version`; the canonical entry for the id. */
function findPackEntry(lock: Lockfile, id: string, kind: CatalogEntry['kind']): CanonicalPackageEntry | null {
  return canonicalPackageEntries(lock).find((candidate) => candidate.entry.kind === kind && candidate.id === id) ?? null
}

/**
 * The engine's answer for one record: offered → true, observed otherwise →
 * false, no successful observation (or no record at all) → null.
 */
export function updateAvailableOf(record: UpdateRecord | undefined): boolean | null {
  if (!record || record.outcome === 'unknown') return null
  return isUpdateOffered(record)
}

/** A lockfile package is a `package` subject, or a `hub-skill` one when it was synthesized from a hub bundle; a record observed for another installed identity is no answer. */
function packageRecord(records: UpdateRecordMap, installed: CanonicalPackageEntry): UpdateRecord | undefined {
  const record = records.get(`package:${installed.id}`) ?? records.get(`hub-skill:${installed.id}`)
  if (!record) return undefined
  // Hub skills carry the hub's resolved version as their installed identity; packages carry the lock entry's.
  if (record.subject.kind === 'hub-skill') return record
  return updateRecordMatchesInstalled(record, { version: installed.entry.version, sha: installed.entry.commitSha || undefined }) ? record : undefined
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
        updateAvailable: null,
        installedVersion: sources.builtinVersions?.get(entry.id) ?? null,
      }
    }

    if (entry.kind === 'agent') {
      const installed = findAgentEntry(sources.packageLock, entry.id)
      return {
        ...entry,
        installed: installed !== null,
        updateAvailable: installed ? updateAvailableOf(packageRecord(records, installed)) : null,
        installedVersion: installed?.entry.version ?? null,
      }
    }

    if (entry.kind === 'plugin') {
      const installed = sources.pluginLock.plugins[entry.id] ?? null
      return {
        ...entry,
        installed: installed !== null || sources.installedPluginDirs.has(entry.id),
        updateAvailable: installed ? updateAvailableOf(pluginRecord(records, entry.id, installed)) : null,
        installedVersion: installed?.version ?? null,
      }
    }

    const installed = findPackEntry(sources.packageLock, entry.id, entry.kind)
    return {
      ...entry,
      installed: installed !== null,
      updateAvailable: installed ? updateAvailableOf(packageRecord(records, installed)) : null,
      installedVersion: installed?.entry.version ?? null,
    }
  })
}
