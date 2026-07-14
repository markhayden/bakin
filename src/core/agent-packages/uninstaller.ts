/**
 * Uninstaller — `bakin agents remove` and `bakin packages remove`.
 *
 * Reverses an install. Removes projected files, strips lesson markers,
 * decrements ref-counts on dependencies (recursively removing dep packs
 * that drop to zero), optionally deletes the runtime agent, and updates
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
import { PackageNotInstalledError, PackageStillRequiredError } from './errors'
import { unprojectPackage } from './projector'
import {
  acquireInstallLock,
  releaseInstallLock,
} from './install-lock'
import { getAppServices } from '../app-services'

const log = createLogger('agent-pkg:uninstall')

async function removeRuntimeAgent(agentId: string): Promise<void> {
  await getAppServices().runtime.agents.remove(agentId)
}

async function removeRuntimeAllowListReferences(agentId: string): Promise<void> {
  const runtime = getAppServices().runtime
  const agents = await runtime.agents.list()
  await Promise.all(
    agents
      .filter((agent) => agent.id !== agentId)
      .map((agent) => runtime.agents.updateAllowlist(agent.id, { remove: [agentId] })),
  )
}

export interface RemoveOptions {
  packageId: string
  /** When true, leave lesson-marker projections in place — only strip files. */
  keepBlocks?: boolean
  /** When true (kind:"agent" only), also call the runtime to delete the agent. */
  deleteAgent?: boolean
  /** When true, refuse-on-dependents is downgraded to a warning + force-remove. */
  force?: boolean
}

export interface RemoveResult {
  packageId: string
  removed: string[] // package ids that were removed (parent + orphaned deps)
  kept: string[]   // dep package ids kept (still have other dependents)
  deletedAgent: boolean
  deleteAgentError?: string
}

/** Projection kinds whose targets may be shared across packs (refcounted removal). */
const SHARED_ARTIFACT_KINDS = new Set(['bin', 'model'])

/**
 * Drop `bin`/`model` projections whose target another installed package
 * (any key except `selfKey`) still projects — shared artifacts survive
 * until their LAST referencing package is removed. All other projections
 * pass through. (npm payloads are per-pack paths — never shared.)
 * Exported for the updater: dropping an artifact on version upgrade must
 * honor the same sharing rule as package removal.
 */
export function withoutSharedArtifacts(
  lock: ReturnType<typeof readLockfile>,
  selfKey: string,
  projections: NonNullable<ReturnType<typeof readLockfile>['packages'][string]['projections']>,
): typeof projections {
  const otherTargets = new Set<string>()
  for (const [key, pkg] of Object.entries(lock.packages)) {
    if (key === selfKey) continue
    for (const p of pkg.projections ?? []) {
      if (SHARED_ARTIFACT_KINDS.has(p.kind)) otherTargets.add(p.target)
    }
  }
  return projections.filter((p) => !SHARED_ARTIFACT_KINDS.has(p.kind) || !otherTargets.has(p.target))
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
      throw new PackageNotInstalledError(options.packageId)
    }

    if (!options.force && hasDependents(lock, options.packageId)) {
      throw new PackageStillRequiredError(options.packageId, entry.dependents ?? [])
    }

    const removed: string[] = []
    const kept: string[] = []

    // 1. Unproject parent
    if (entry.projections && entry.projections.length > 0) {
      await unprojectPackage(withoutSharedArtifacts(lock, options.packageId, entry.projections), { keepBlocks: options.keepBlocks })
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
    //
    // Cascade recurses N levels: when a dep's refCount hits 0 we remove it
    // AND walk its own `dependencies`, decrementing each by the now-removed
    // intermediate. This handles 3+-deep chains correctly.
    const cascadeRemove = async (
      currentLock: typeof lock,
      depKeys: string[],
      dependentKey: string,
    ): Promise<typeof lock> => {
      let l = currentLock
      for (const depKey of depKeys) {
        l = decrementRefCount(l, depKey, dependentKey)
        const depEntry = l.packages[depKey]
        if (!depEntry) continue
        if ((depEntry.refCount ?? 0) <= 0) {
          // Orphaned — unproject + remove install dir + recurse into its
          // own deps before dropping the lockfile entry.
          if (depEntry.projections && depEntry.projections.length > 0) {
            await unprojectPackage(withoutSharedArtifacts(l, depKey, depEntry.projections), { keepBlocks: options.keepBlocks })
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
          // Recurse — the orphaned dep's transitive deps cascade with the
          // orphan as the dependent (NOT the original package being removed).
          if (depEntry.dependencies && depEntry.dependencies.length > 0) {
            l = await cascadeRemove(l, depEntry.dependencies, depKey)
          }
          l = removePackage(l, depKey)
          removed.push(depKey)
        } else {
          if (!kept.includes(depKey)) kept.push(depKey)
        }
      }
      return l
    }

    lock = removePackage(lock, options.packageId)
    removed.push(options.packageId)
    lock = await cascadeRemove(lock, entry.dependencies ?? [], options.packageId)

    writeLockfile(lock)

    // 4. Optionally delete the runtime agent for kind:"agent"
    let deletedAgent = false
    let deleteAgentError: string | undefined
    if (entry.kind === 'agent' && entry.agentId && options.deleteAgent) {
      try {
        await removeRuntimeAgent(entry.agentId)
        await removeRuntimeAllowListReferences(entry.agentId)
        deletedAgent = true
      } catch (err) {
        deleteAgentError = err instanceof Error ? err.message : String(err)
        log.warn('Failed to delete runtime agent', {
          agentId: entry.agentId,
          error: deleteAgentError,
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
        deleteAgentError,
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
      ...(deleteAgentError ? { deleteAgentError } : {}),
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
