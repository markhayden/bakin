/**
 * Install-state join: catalog entries × local lockfiles.
 *
 * Lockfiles are the ground truth so GET /catalog stays offline-safe and
 * runtime-independent — no network I/O, no runtime adapter calls:
 *   - agents:  ~/.bakin/packages/lock.json entries with kind 'agent'
 *   - plugins: ~/.bakin/plugins/lock.json (+ builtin short-circuit)
 *   - packs:   ~/.bakin/packages/lock.json non-agent entries
 *
 * updateAvailable comes from persisted plugin probe markers only; agent
 * update state is probe-only upstream (never persisted), so agents report
 * `null` (unknown) until an explicit check runs (S6).
 */
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  computeUpgradeAvailable,
  readPluginLockfile,
  type PluginLockfile,
} from '@bakin/core/plugins/lockfile'
import { readLockfile, type Lockfile, type PackageEntry } from '@bakin/core/agent-packages/lockfile'
import { getContentDir } from '../../../src/core/content-dir'
import type { CatalogEntry } from '../../../src/core/curated-catalog/schema'
import type { ExploreCatalogEntry } from '../types'

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

function findAgentEntry(lock: Lockfile, agentId: string): PackageEntry | null {
  for (const entry of Object.values(lock.packages)) {
    if (entry.kind === 'agent' && entry.agentId === agentId) return entry
  }
  return null
}

/** Pack lockfile keys are `id` or `id@version` — match either. */
function findPackEntry(lock: Lockfile, id: string, kind: CatalogEntry['kind']): PackageEntry | null {
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (entry.kind !== kind) continue
    if (key === id || key.startsWith(`${id}@`)) return entry
  }
  return null
}

export function joinInstallState(
  entries: readonly CatalogEntry[],
  sources: InstallStateSources,
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
        updateAvailable: null,
        installedVersion: installed?.version ?? null,
      }
    }

    if (entry.kind === 'plugin') {
      const installed = sources.pluginLock.plugins[entry.id] ?? null
      return {
        ...entry,
        installed: installed !== null || sources.installedPluginDirs.has(entry.id),
        updateAvailable: installed ? computeUpgradeAvailable(installed) : null,
        installedVersion: installed?.version ?? null,
      }
    }

    const installed = findPackEntry(sources.packageLock, entry.id, entry.kind)
    return {
      ...entry,
      installed: installed !== null,
      updateAvailable: null,
      installedVersion: installed?.version ?? null,
    }
  })
}
