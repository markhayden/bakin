/**
 * Installer orchestrator — the public entry point for `bakin agents install`
 * and the standalone `bakin packages install`.
 *
 * Responsibility: wire fetcher → resolver → projector → lockfile →
 * runtime adapter, with pre-flight collision checks and a release-on-exit
 * advisory lock so two concurrent installs can't corrupt the lockfile.
 *
 * Flow:
 *   1. Acquire ~/.bakin/packages/.lock
 *   2. Fetch top-level source → staging
 *   3. Validate manifest
 *   4. For kind:"agent" — figure out target agent state (absent / unmanaged /
 *      managed) and decide install mode (fresh / adopt / refuse)
 *   5. Resolve declared dependencies (single-level for V1)
 *   6. Pre-flight collision check — refuse if any projection target collides
 *      with a different package's existing projection (different sha)
 *   7. Project deps in declaration order, then project the parent
 *   8. For kind:"agent" + fresh — create the runtime agent; for adopt mode —
 *      leave the runtime roster alone
 *   9. Update lockfile with parent + dep entries (atomic write)
 *   10. Move staging dirs into final ~/.bakin/packages/<kind>s/<id>@<ver>/
 *   11. Append audit event(s)
 *   12. Release lock
 *
 * On any failure: every projection so far is rolled back via the
 * projector's writeLog, the staging dirs are cleaned up, the lockfile
 * is left at its pre-install state, and the install lock is released.
 */
import { existsSync, rmSync, statSync } from 'fs'
import { commitStaging } from '../install-core/transaction'
import { createLogger } from '../logger'
import { SkillRefusalError } from './errors'
import { getContentDir } from '../content-dir'
import { appendAudit } from '../audit'
import {
  formatManifestError,
  type Manifest,
  parseManifest,
} from '../../../packages/core/src/agent-packages/manifest'
import {
  type Lockfile,
  type PackageEntry,
  addPackage,
  incrementRefCount,
  readLockfile,
  writeLockfile,
} from '../../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../../packages/core/src/agent-packages/package-paths'
import {
  type FetchedSource,
  fetchSourceAsync,
} from './source-fetcher'
import {
  resolveDependenciesAsync,
  type ResolvedDep,
} from './dependency-resolver'
import {
  projectPackage,
  unprojectPackage,
  type ProjectorResult,
} from './projector'
import { getAgentState } from './agent-state'
import {
  acquireInstallLock,
  releaseInstallLock,
} from './install-lock'
import { getAppServices } from '../app-services'
import { readFileSync } from 'fs'
import { join } from 'path'
import { validatePackageContributionIntegrity } from './package-integrity'
import { installManifestRequirements } from './requirements-installer'
import { withoutSharedArtifacts } from './uninstaller'
import { binPlatformKey } from './bin-installer'
import { getSettings } from '../settings'

const log = createLogger('agent-pkg:install')

// ─── Public types ────────────────────────────────────────────────────────────

export interface InstallOptions {
  /** Source spec — local path or `github:user/repo[@ref][#subpath]`. */
  source: string
  /**
   * Force adoption of an existing runtime agent rather than creating a
   * fresh one. Only valid for kind:"agent" packages where the agent id
   * already exists in the runtime roster.
   */
  adopt?: boolean
  /**
   * Override the resolved package id on collision (rarely needed at the
   * top level — most user-encountered collisions resolve via package
   * authors' `dependencies[].installAs`). Maps to lockfile key.
   */
  installAs?: string
  /**
   * Permit overwrite of an existing projection target whose sha differs.
   * Only effective with explicit user confirmation upstream — the CLI
   * surface routes through a y/N prompt.
   */
  replace?: boolean
  /**
   * An already-fetched+staged top-level source to install verbatim, instead
   * of re-fetching `source` (#687 consent TOCTOU fix): the skills trust gate
   * verifies staging against the consent sha and hands THAT exact tree here,
   * so the bytes reviewed are the bytes installed. The installer consumes
   * the staging dir (moves it into place); the caller must not reuse it.
   */
  prefetched?: FetchedSource
}

export interface InstallResult {
  packageId: string
  /** kind from the manifest. */
  kind: Manifest['kind']
  /** True iff the runtime roster was mutated (kind:"agent" fresh installs only). */
  createdAgent: boolean
  /** True iff this was an adopt rather than a fresh install. */
  adopted: boolean
  /** Resolved deps installed alongside the parent. */
  dependencies: { packageId: string; kind: Manifest['kind']; version: string }[]
  /** Skipped projection targets (.userEdited). */
  skipped: { target: string; reason: 'userEdited' }[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface PreflightCollision {
  target: string
  existingPackageId: string
  newPackageId: string
}

/**
 * Pre-flight check — gather every projection target the about-to-install
 * packages will write to, cross-reference against the existing lockfile,
 * and return any collisions. Same package re-installing same target is
 * not a collision; only different-package overlaps count.
 *
 * V1 uses path-equality for collision detection. Sha mismatch isn't
 * checked here because the new sha isn't known until the projection
 * runs — but the `replace: true` flag skips this entire check, and
 * installAs upstream already changed the resolvedId so the projection
 * target paths differ.
 */
function preflightCollisions(
  lock: Lockfile,
  parentId: string,
  resolved: ResolvedDep[],
): PreflightCollision[] {
  const collisions: PreflightCollision[] = []
  const newPackageIds = new Set<string>([parentId, ...resolved.map((r) => r.resolvedId)])

  // Build a lookup of every existing target → owning package id from the
  // lockfile (excluding the packages we're re-installing).
  const existing = new Map<string, string>()
  for (const [pkgId, entry] of Object.entries(lock.packages)) {
    if (newPackageIds.has(pkgId)) continue
    for (const p of entry.projections ?? []) {
      // Lesson-marker projections share the SOUL.md target across
      // packages — that's not a collision (each block has its own id).
      if (p.kind === 'lesson-marker') continue
      existing.set(p.target, pkgId)
    }
  }

  return collisions
  // Note: this function returns [] for V1 — the actual check is done at
  // projection time by the projector's overwrite-replace logic. Phase H-4
  // adds path-level pre-flight; structuring it here gives us the seam.
}

/**
 * D14 (#687): runtimes/platforms declarations are enforced at install, not
 * just badged in Explore. A pack that can't work here refuses honestly
 * before any projection. Audited so refusals are visible after the fact.
 */
export function assertRuntimePlatformCompatible(manifest: Manifest): void {
  const runtimes = 'runtimes' in manifest ? manifest.runtimes : undefined
  if (runtimes && runtimes.length > 0 && !runtimes.includes('*')) {
    const active = getSettings().runtime.adapter
    if (!runtimes.includes(active)) {
      appendAudit(getContentDir(), 'pkg.install_refused', manifest.id, {
        packageId: manifest.id,
        reason: 'runtime-incompatible',
        activeAdapter: active,
        runtimes,
      }, 'cli')
      throw new SkillRefusalError(
        `Package "${manifest.id}" is not for the active runtime (${active}) — compatible: ${runtimes.join(', ')}.`,
        'runtime',
      )
    }
  }

  const platforms = 'platforms' in manifest ? manifest.platforms : undefined
  if (platforms && platforms.length > 0) {
    const platform = binPlatformKey()
    if (!platform || !platforms.includes(platform)) {
      appendAudit(getContentDir(), 'pkg.install_refused', manifest.id, {
        packageId: manifest.id,
        reason: 'platform-incompatible',
        platform: platform ?? 'unknown',
        platforms,
      }, 'cli')
      throw new SkillRefusalError(
        `Package "${manifest.id}" is not available on this platform — needs ${platforms.join(' or ')}.`,
        'platform',
      )
    }
  }
}

interface AdapterCreateAgentInput {
  id: string
  name: string
  emoji?: string
  role?: string
  model?: string
}

async function createRuntimeAgent(input: AdapterCreateAgentInput): Promise<void> {
  await getAppServices().runtime.agents.create({
    id: input.id,
    name: input.name,
    role: input.role,
    model: input.model,
    metadata: input.emoji ? { emoji: input.emoji } : undefined,
  })
}

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

async function addRuntimeAllowLists(newAgentId: string, dispatchable: 'all' | 'main' | string[]): Promise<void> {
  const runtime = getAppServices().runtime
  if (dispatchable === 'main') {
    await runtime.agents.updateAllowlist('main', { add: [newAgentId] })
    return
  }

  if (dispatchable === 'all') {
    const agents = await runtime.agents.list()
    await Promise.all(
      agents
        .filter((agent) => agent.id !== newAgentId)
        .map((agent) => runtime.agents.updateAllowlist(agent.id, { add: [newAgentId] })),
    )
    return
  }

  const targetIds = new Set(dispatchable)
  targetIds.add('main')
  targetIds.delete(newAgentId)
  await Promise.all(Array.from(targetIds).map((agentId) => runtime.agents.updateAllowlist(agentId, { add: [newAgentId] })))
}

/**
 * Walk a parsed manifest's `dependencies` and return the lockfile keys of
 * the immediate deps it declared. Looks each dep up by `<source>@<ref>`
 * in a map the resolver already built — this avoids re-parsing local-source
 * paths into manifest ids (fragile heuristic that breaks for paths that
 * don't end in the agent id).
 */
function listImmediateDeps(
  manifest: Manifest,
  sourceToLockKey: Map<string, string>,
): string[] {
  const out: string[] = []
  const deps = manifest.dependencies
  const slots: Array<Array<{ source: string; ref: string }> | undefined> = [
    deps?.skills,
    deps?.workflows,
    deps?.lessons,
  ]
  for (const slot of slots) {
    if (!slot) continue
    for (const dep of slot) {
      const sourceKey = `${dep.source}@${dep.ref}`
      const lockKey = sourceToLockKey.get(sourceKey)
      if (lockKey) out.push(lockKey)
    }
  }
  return out
}

function manifestToCreateAgent(manifest: Manifest): AdapterCreateAgentInput {
  if (manifest.kind !== 'agent') {
    throw new Error(`manifestToCreateAgent called with non-agent kind: ${manifest.kind}`)
  }
  return {
    id: manifest.id,
    name: manifest.agent.identity.name,
    emoji: manifest.agent.identity.emoji,
    role: manifest.agent.role,
    model: manifest.agent.defaultModel,
  }
}

// ─── Main install function ───────────────────────────────────────────────────

export async function installPackage(options: InstallOptions): Promise<InstallResult> {
  acquireInstallLock()

  let topFetched: FetchedSource | null = null
  const depFetched: FetchedSource[] = []
  const projected: { resolvedId: string; result: ProjectorResult }[] = []
  let createdAgent = false
  let adopted = false
  let agentId: string | undefined
  const finalInstallDirs: string[] = [] // for cleanup-on-failure
  let originalLock: Lockfile | null = null

  try {
    // ─── 1. Fetch top-level source (or adopt a pre-verified staging dir) ────
    if (options.prefetched) {
      log.info('Installing pre-fetched (consent-verified) source', { source: options.source })
      topFetched = options.prefetched
    } else {
      log.info('Fetching package source', { source: options.source })
      topFetched = await fetchSourceAsync(options.source)
    }

    // ─── 2. Parse + validate manifest ──────────────────────────────────────
    const manifestPath = join(topFetched.stagingDir, 'bakin-package.json')
    let manifest: Manifest
    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      manifest = parseManifest(raw)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Re-throw with context — the formatManifestError signature requires a
      // ZodError, which parseManifest's throw wraps. The fallback message
      // covers JSON parse failures and other non-zod throws.
      throw new Error(
        manifest! === undefined ? `Manifest parse failed: ${message}` : `Manifest validation failed: ${formatManifestError(err as never)}`,
        { cause: err },
      )
    }

    const resolvedTopId = options.installAs ?? manifest.id
    assertRuntimePlatformCompatible(manifest)
    validatePackageContributionIntegrity({
      manifest,
      stagingDir: topFetched.stagingDir,
    })

    // ─── 3. Compute install mode for kind:"agent" ──────────────────────────
    const lock = readLockfile()
    originalLock = lock
    let mode: 'fresh' | 'adopt' = 'fresh'

    // Lockfile key conventions:
    //   - agent kind:        plain id (e.g. "pixel")        — one agent per id
    //   - non-agent kinds:   compound (e.g. "visual@0.3.1") — multiple versions
    //                        of the same pack can coexist during update
    const parentLockfileKey =
      manifest.kind === 'agent'
        ? resolvedTopId
        : `${resolvedTopId}@${manifest.version}`

    if (manifest.kind !== 'agent' && lock.packages[parentLockfileKey] && !options.replace) {
      throw new Error(
        `Package "${parentLockfileKey}" is already installed. ` +
          `Run \`bakin packages sync ${parentLockfileKey}\` to update or \`bakin packages remove ${parentLockfileKey}\` first.`,
      )
    }

    if (manifest.kind === 'agent') {
      agentId = manifest.id
      const stateInfo = await getAgentState(agentId, lock)
      if (stateInfo.state === 'managed') {
        throw new Error(
          `Agent "${agentId}" is already managed by package "${stateInfo.packageId}". ` +
            `Run \`bakin agents sync ${stateInfo.packageId}\` to update or \`bakin agents remove ${stateInfo.packageId}\` first.`,
        )
      }
      if (stateInfo.state === 'unmanaged') {
        if (!options.adopt) {
          throw new Error(
            `Agent "${agentId}" already exists in the runtime but is unmanaged. ` +
              `Pass --adopt to attach this package to the existing agent, or remove the agent first.`,
          )
        }
        mode = 'adopt'
        adopted = true
      } else {
        // state === 'absent' — fresh install
        if (options.adopt) {
          throw new Error(
            `Cannot --adopt agent "${agentId}" — it does not exist in the runtime. ` +
              `Drop the --adopt flag to create + manage it fresh.`,
          )
        }
        mode = 'fresh'
      }
    }

    // ─── 4. Resolve dependencies ───────────────────────────────────────────
    const resolved = await resolveDependenciesAsync(manifest)
    for (const r of resolved) depFetched.push(r.fetched)
    for (const r of resolved) {
      assertRuntimePlatformCompatible(r.manifest)
      validatePackageContributionIntegrity({
        manifest: r.manifest,
        stagingDir: r.fetched.stagingDir,
      })
    }

    // ─── 5. Pre-flight collision check ─────────────────────────────────────
    const collisions = preflightCollisions(lock, resolvedTopId, resolved)
    if (collisions.length > 0 && !options.replace) {
      const lines = collisions.map(
        (c) => `  - ${c.target} already projected by "${c.existingPackageId}" (would be overwritten by "${c.newPackageId}")`,
      )
      throw new Error(
        `Refusing install — ${collisions.length} projection collision(s):\n${lines.join('\n')}\n` +
          `Add an installAs alias in the manifest, or pass --replace to override.`,
      )
    }

    // ─── 6. Project dependencies first (leaves-first) ─────────────────────
    for (const dep of resolved) {
      log.info('Projecting dependency', { dep: dep.resolvedId, pulledBy: dep.pulledBy })
      const result = await projectPackage({
        manifest: dep.manifest,
        stagingDir: dep.fetched.stagingDir,
        agentId: undefined,
        replace: options.replace,
        installedBy: {
          package: dep.resolvedId,
          version: dep.manifest.version,
          ref: dep.spec.ref,
          commitSha: dep.fetched.commitSha,
          installedAt: new Date().toISOString(),
        },
      })
      projected.push({ resolvedId: dep.resolvedId, result })
      await installManifestRequirements({
        manifest: dep.manifest,
        packId: dep.resolvedId,
        sourceDir: dep.fetched.stagingDir,
        installedBy: {
          package: dep.resolvedId,
          version: dep.manifest.version,
          ref: dep.spec.ref,
          commitSha: dep.fetched.commitSha,
          installedAt: new Date().toISOString(),
        },
        result,
      })
    }

    // ─── 7. Project the parent package ─────────────────────────────────────
    log.info('Projecting parent package', { id: resolvedTopId, kind: manifest.kind, mode })
    const parentResult = await projectPackage({
      manifest,
      stagingDir: topFetched.stagingDir,
      agentId,
      replace: options.replace,
      installedBy: {
        package: resolvedTopId,
        version: manifest.version,
        ref: topFetched.ref,
        commitSha: topFetched.commitSha,
        installedAt: new Date().toISOString(),
      },
    })
    projected.push({ resolvedId: resolvedTopId, result: parentResult })
    await installManifestRequirements({
      manifest,
      packId: resolvedTopId,
      sourceDir: topFetched.stagingDir,
      installedBy: {
        package: resolvedTopId,
        version: manifest.version,
        ref: topFetched.ref,
        commitSha: topFetched.commitSha,
        installedAt: new Date().toISOString(),
      },
      result: parentResult,
    })

    // ─── 8. Create runtime agent for kind:"agent" + fresh ────────────────
    if (manifest.kind === 'agent' && mode === 'fresh') {
      const input = manifestToCreateAgent(manifest)
      await createRuntimeAgent(input)
      createdAgent = true

      const dispatchableBy = manifest.agent.dispatchableBy
      if (dispatchableBy && dispatchableBy.length > 0) {
        const target = dispatchableBy.length === 1 && dispatchableBy[0] === 'main' ? 'main' : dispatchableBy
        await addRuntimeAllowLists(manifest.id, target)
      }
    }

    // ─── 9. Update lockfile ────────────────────────────────────────────────
    let nextLock = lock
    const installedAt = new Date().toISOString()

    // Build two maps so transitive deps record their IMMEDIATE parent
    // (not the top-level package) as the dependent. Cascade removal of a
    // 3+-deep chain depends on each entry pointing at the right immediate
    // parent rather than the top-level installer-invocation root.
    //
    //   idToLockKey:     manifest.id  → lockfile-key (used by incrementRefCount)
    //   sourceToLockKey: `<source>@<ref>` → lockfile-key (used by
    //                    listImmediateDeps to resolve local-path deps without
    //                    parsing the path back into a manifest id)
    const idToLockKey = new Map<string, string>()
    const sourceToLockKey = new Map<string, string>()
    idToLockKey.set(manifest.id, parentLockfileKey)
    for (const dep of resolved) {
      const depKey = `${dep.resolvedId}@${dep.manifest.version}`
      idToLockKey.set(dep.manifest.id, depKey)
      sourceToLockKey.set(`${dep.spec.source}@${dep.spec.ref}`, depKey)
    }

    // Dep entries first
    for (const dep of resolved) {
      const depKey = `${dep.resolvedId}@${dep.manifest.version}`
      const existing = nextLock.packages[depKey]
      const projectedFor = projected.find((p) => p.resolvedId === dep.resolvedId)
      const entry: PackageEntry = {
        kind: dep.manifest.kind,
        version: dep.manifest.version,
        source: dep.spec.source,
        ref: dep.spec.ref,
        commitSha: dep.fetched.commitSha,
        installedAt: existing?.installedAt ?? installedAt,
        projections: projectedFor?.result.projections ?? [],
        refCount: existing?.refCount ?? 0,
        dependents: existing?.dependents ?? [],
        // Record any transitive deps this dep itself pulled in so the
        // uninstaller can cascade-remove orphans.
        dependencies: listImmediateDeps(dep.manifest, sourceToLockKey),
      }
      nextLock = addPackage(nextLock, depKey, entry)

      // Increment refCount against the IMMEDIATE parent — for top-level
      // direct deps that's the agent / parent pkg id; for transitive deps
      // that's the intermediate package's lockfile key. Without this, all
      // transitive deps would track the top-level package and removing
      // intermediates wouldn't decrement leaves correctly.
      const immediateDependentKey = idToLockKey.get(dep.pulledBy) ?? parentLockfileKey
      nextLock = incrementRefCount(nextLock, depKey, immediateDependentKey)
    }

    // Parent entry
    const parentEntry: PackageEntry = {
      kind: manifest.kind,
      version: manifest.version,
      source: options.source,
      ref: topFetched.ref,
      commitSha: topFetched.commitSha,
      installedAt,
      projections: parentResult.projections,
      dependencies: resolved.map((r) => `${r.resolvedId}@${r.manifest.version}`),
    }
    if (manifest.kind === 'agent' && agentId) {
      parentEntry.state = 'managed'
      parentEntry.agentId = agentId
      parentEntry.lessonsEnabled =
        manifest.install.enableLessons ??
        []
    } else {
      // Non-agent kinds (skill-pack / workflow-pack / lesson-pack) live as
      // top-level entries with no agent state. Initialize refCount/dependents
      // so other packages can depend on them later via incrementRefCount.
      parentEntry.refCount = 0
      parentEntry.dependents = []
    }
    nextLock = addPackage(nextLock, parentLockfileKey, parentEntry)

    writeLockfile(nextLock)

    // ─── 10. Commit staging → final install dirs ──────────────────────────
    for (const dep of resolved) {
      const finalDir = getPackageSourceDir(
        getContentDir(),
        dep.manifest.kind,
        dep.resolvedId,
        dep.manifest.version,
      )
      commitStaging(dep.fetched.stagingDir, finalDir)
      finalInstallDirs.push(finalDir)
    }
    const parentFinalDir = getPackageSourceDir(
      getContentDir(),
      manifest.kind,
      resolvedTopId,
      manifest.version,
    )
    commitStaging(topFetched.stagingDir, parentFinalDir)
    finalInstallDirs.push(parentFinalDir)

    // ─── 11. Audit ────────────────────────────────────────────────────────
    const eventName = adopted ? 'agent_pkg.adopted' : (manifest.kind === 'agent' ? 'agent_pkg.installed' : 'pkg.installed')
    appendAudit(getContentDir(), eventName, agentId ?? resolvedTopId, {
      packageId: resolvedTopId,
      kind: manifest.kind,
      version: manifest.version,
      source: options.source,
      ref: topFetched.ref,
      commitSha: topFetched.commitSha,
      ...(agentId ? { agentId, state: parentEntry.state } : {}),
      ...(adopted ? { adopted: true } : {}),
      ...(createdAgent ? { createdAgent: true } : {}),
      lessonsEnabled: parentEntry.lessonsEnabled ?? [],
      dependencies: resolved.map((r) => `${r.resolvedId}@${r.manifest.version}`),
    }, 'cli')

    return {
      packageId: resolvedTopId,
      kind: manifest.kind,
      createdAgent,
      adopted,
      dependencies: resolved.map((r) => ({
        packageId: r.resolvedId,
        kind: r.manifest.kind,
        version: r.manifest.version,
      })),
      skipped: parentResult.skipped,
    }
  } catch (err) {
    if (createdAgent && agentId) {
      try {
        await removeRuntimeAllowListReferences(agentId)
      } catch (rollbackErr) {
        log.warn('Runtime allowlist cleanup during install failure threw', {
          agentId,
          error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
        })
      }
      try {
        await removeRuntimeAgent(agentId)
      } catch (rollbackErr) {
        log.warn('Runtime agent cleanup during install failure threw', {
          agentId,
          error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
        })
      }
    }

    // Roll back projections (every staged write so far). Shared artifacts
    // (bins/models another INSTALLED pack still projects) survive — a failed
    // install of pack B must never delete files pack A depends on.
    const lockAtFailure = readLockfile()
    for (const p of [...projected].reverse()) {
      try {
        await unprojectPackage(withoutSharedArtifacts(lockAtFailure, p.resolvedId, p.result.projections))
      } catch (rollbackErr) {
        log.warn('Rollback during install failure threw', {
          packageId: p.resolvedId,
          error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
        })
      }
    }
    // Clean up any committed install dirs (rare — only if commit happened
    // before the error)
    for (const dir of finalInstallDirs) {
      if (existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          /* best-effort */
        }
      }
    }
    if (originalLock) {
      try {
        writeLockfile(originalLock)
      } catch (rollbackErr) {
        log.warn('Lockfile rollback during install failure threw', {
          error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
        })
      }
    }
    // Clean up staging dirs (top + deps)
    if (topFetched && existsSync(topFetched.stagingDir)) {
      try {
        rmSync(topFetched.stagingDir, { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
    }
    for (const f of depFetched) {
      if (existsSync(f.stagingDir)) {
        try {
          rmSync(f.stagingDir, { recursive: true, force: true })
        } catch {
          /* best-effort */
        }
      }
    }
    throw err
  } finally {
    releaseInstallLock()
  }
}

// Reference statSync to silence the unused-import warning the TS compiler
// would emit. Used implicitly via the rmSync existsSync fallback paths
// future maintenance may add.
void statSync
