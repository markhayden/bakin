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
import {
  computeUpgradeAvailable,
  readPluginLockfile,
  type PluginLockfile,
} from '@bakin/core/plugins/lockfile'
import { readLockfile, type Lockfile, type PackageEntry } from '@bakin/core/agent-packages/lockfile'
import type { CatalogEntry } from '../../../src/core/curated-catalog/schema'
import type { ExploreCatalogEntry } from '../types'

export interface InstallStateSources {
  pluginLock: PluginLockfile
  packageLock: Lockfile
}

export function gatherInstallSources(): InstallStateSources {
  return {
    pluginLock: readPluginLockfile(),
    packageLock: readLockfile(),
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
      return { ...entry, installed: true, updateAvailable: null, installedVersion: null }
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
        installed: installed !== null,
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
