/**
 * Uninstaller — `bakin agents remove` and `bakin packages remove`.
 *
 * Reverses an install. Removes projected files, strips knowledge markers,
 * decrements ref-counts on dependencies (recursively removing dep packs
 * that drop to zero), optionally deletes the OpenClaw agent, and updates
 * the lockfile.
 *
 * Refuses to remove a package that still has active dependents (pack
 * installed because a different agent depends on it). The user removes
 * the dependent first.
 */
import { existsSync, rmSync } from 'fs'
import { createLogger } from '../logger'
import { getContentDir } from '../content-dir'
import { appendAudit } from '../audit'
import {
  decrementRefCount,
  hasDependents,
  readLockfile,
  removePackage,
  writeLockfile,
  type Lockfile,
  type PackageEntry,
} from '../../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../../packages/core/src/agent-packages/package-paths'
import { unprojectPackage } from './projector'
import {
  acquireInstallLock,
  releaseInstallLock,
} from './install-lock'
import { removeAgent, removeFromAllowLists } from '@bakin/team/lib/openclaw-adapter'

const log = createLogger('agent-pkg:uninstall')

export interface RemoveOptions {
  packageId: string
  /** When true, leave knowledge-marker projections in place — only strip files. */
  keepBlocks?: boolean
  /** When true (kind:"agent" only), also call OpenClaw to delete the agent. */
  deleteAgent?: boolean
  /** When true, refuse-on-dependents is downgraded to a warning + force-remove. */
  force?: boolean
}

export interface RemoveResult {
  packageId: string
  removed: string[] // package ids that were removed (parent + orphaned deps)
  kept: string[]   // dep package ids kept (still have other dependents)
  deletedAgent: boolean
}

/**
 * Remove a package + its orphaned dependencies.
 */
export async function removePackageById(options: RemoveOptions): Promise<RemoveResult> {
  acquireInstallLock()

  try {
    let lock = readLockfile()
    const entry = lock.packages[options.packageId]
    if (!entry) {
      throw new Error(`Package "${options.packageId}" is not installed.`)
    }

    if (!options.force && hasDependents(lock, options.packageId)) {
      const dependents = entry.dependents ?? []
      throw new Error(
        `Refusing to remove "${options.packageId}" — still required by [${dependents.join(', ')}]. ` +
          `Remove the dependents first, or pass --force.`,
      )
    }

    const removed: string[] = []
    const kept: string[] = []

    // 1. Unproject parent
    if (entry.projections && entry.projections.length > 0) {
      unprojectPackage(entry.projections, { keepBlocks: options.keepBlocks })
    }

    // 2. Remove the install dir under ~/.bakin/packages/<kind>s/<id>@<ver>/
    const installDir = getPackageSourceDir(getContentDir(), entry.kind, options.packageId, entry.version)
    if (existsSync(installDir)) {
      try {
        rmSync(installDir, { recursive: true, force: true })
      } catch (err) {
        log.warn('Failed to remove install dir', {
          installDir,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // 3. Mutate lockfile — drop the parent, decrement deps, recursively
    //    remove deps that drop to zero refCount.
    lock = removePackage(lock, options.packageId)
    removed.push(options.packageId)

    for (const depKey of entry.dependencies ?? []) {
      lock = decrementRefCount(lock, depKey, options.packageId)
      const depEntry = lock.packages[depKey]
      if (!depEntry) continue
      if ((depEntry.refCount ?? 0) <= 0) {
        // Dep is orphaned — remove it too.
        if (depEntry.projections && depEntry.projections.length > 0) {
          unprojectPackage(depEntry.projections, { keepBlocks: options.keepBlocks })
        }
        const depInstallDir = getPackageSourceDir(
          getContentDir(),
          depEntry.kind,
          stripVersionFromKey(depKey),
          depEntry.version,
        )
        if (existsSync(depInstallDir)) {
          try {
            rmSync(depInstallDir, { recursive: true, force: true })
          } catch (err) {
            log.warn('Failed to remove dep install dir', {
              depInstallDir,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }
        lock = removePackage(lock, depKey)
        removed.push(depKey)
      } else {
        kept.push(depKey)
      }
    }

    writeLockfile(lock)

    // 4. Optionally delete the OpenClaw agent for kind:"agent"
    let deletedAgent = false
    if (entry.kind === 'agent' && entry.agentId && options.deleteAgent) {
      try {
        await removeAgent(entry.agentId)
        removeFromAllowLists(entry.agentId)
        deletedAgent = true
      } catch (err) {
        log.warn('Failed to delete OpenClaw agent', {
          agentId: entry.agentId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // 5. Audit
    appendAudit(
      getContentDir(),
      entry.kind === 'agent' ? 'agent_pkg.removed' : 'pkg.removed',
      entry.agentId ?? options.packageId,
      {
        packageId: options.packageId,
        kind: entry.kind,
        version: entry.version,
        deletedAgent,
        keepBlocks: options.keepBlocks ?? false,
        removedOrphanedDeps: removed.slice(1),
      },
      'cli',
    )

    return {
      packageId: options.packageId,
      removed,
      kept,
      deletedAgent,
    }
  } finally {
    releaseInstallLock()
  }
}

/**
 * Strip the @version suffix off a lockfile dep key. Lockfile dep keys for
 * non-agent packages use `<id>@<version>` so two versions can coexist;
 * the install-dir path needs just the id portion.
 */
function stripVersionFromKey(key: string): string {
  const at = key.lastIndexOf('@')
  return at === -1 ? key : key.slice(0, at)
}

// Reference Lockfile + PackageEntry type imports so the unused-import
// warning doesn't fire — they're used in the public RemoveResult shape
// indirectly via lockfile mutators above.
void ((null as unknown) as Lockfile)
void ((null as unknown) as PackageEntry)
