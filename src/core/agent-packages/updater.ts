/**
 * Source-update flow used by `bakin agents sync` / `bakin packages sync`.
 *
 * Refetches the package's source at the same `source` + `ref` recorded in
 * the lockfile, compares the new commit SHA to the recorded one, and
 * re-projects in update mode if they differ. The runtime roster is NOT
 * touched (defaultModel + dispatchableBy are populated only on fresh
 * install per the settled D5 decision — the user controls models through
 * the Models UI from then on).
 *
 * No-op when commit SHAs match — useful so the sync engine can run it
 * unconditionally as a doctor companion without spamming writes.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'fs'
import { basename, dirname, join } from 'path'
import { createLogger } from '../logger'
import { getContentDir } from '../content-dir'
import { appendAudit } from '../audit'
import {
  parseManifest,
  type Manifest,
} from '../../../packages/core/src/agent-packages/manifest'
import {
  addPackage,
  readLockfile,
  writeLockfile,
  type PackageEntry,
  type ProjectionEntry,
} from '../../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../../packages/core/src/agent-packages/package-paths'
import { fetchSourceAsync, sourceSpecWithRef, type FetchedSource } from './source-fetcher'
import { projectPackage, unprojectPackage } from './projector'
import { installManifestRequirements, modelDest, npmPayloadDir } from './requirements-installer'
import { withoutSharedArtifacts } from './uninstaller'
import {
  acquireInstallLock,
  releaseInstallLock,
} from './install-lock'
import { validatePackageContributionIntegrity } from './package-integrity'
import { assertRuntimePlatformCompatible } from './installer'

const log = createLogger('agent-pkg:update')

export interface UpdateOptions {
  packageId: string
}

export interface UpdateResult {
  packageId: string
  changed: boolean
  fromCommitSha: string
  toCommitSha: string
  fromVersion: string
  toVersion: string
}

/**
 * Update one installed package. Returns `changed: false` when the upstream
 * commit SHA hasn't moved.
 */
export async function updatePackageById(options: UpdateOptions): Promise<UpdateResult> {
  acquireInstallLock()

  let fetched: FetchedSource | null = null

  try {
    const lock = readLockfile()
    const entry = lock.packages[options.packageId]
    if (!entry) {
      throw new Error(`Package "${options.packageId}" is not installed.`)
    }

    // Re-fetch using the same source + ref the lockfile recorded.
    // Async path — clawhub: sources are network-fetched (#687).
    fetched = await fetchSourceAsync(sourceSpecWithRef(entry.source, entry.ref))

    // No-op when the commit SHA hasn't moved. Local sources have empty
    // commitSha — for those we always re-project (the user just ran
    // update, presumably because something changed locally).
    if (entry.commitSha && fetched.commitSha === entry.commitSha) {
      log.info('Update no-op — commit SHA unchanged', {
        packageId: options.packageId,
        commitSha: entry.commitSha,
      })
      return {
        packageId: options.packageId,
        changed: false,
        fromCommitSha: entry.commitSha,
        toCommitSha: fetched.commitSha,
        fromVersion: entry.version,
        toVersion: entry.version,
      }
    }

    // Parse new manifest
    const manifestPath = join(fetched.stagingDir, 'bakin-package.json')
    const manifest: Manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')))

    // D14 also applies on the update path: a new version that dropped the
    // active runtime/platform must refuse, not install-then-flag.
    assertRuntimePlatformCompatible(manifest)

    // Sanity: id must match. Renaming a package mid-install is too dangerous
    // to allow silently — the user runs remove + install instead.
    if (manifest.id !== stripVersionFromKey(options.packageId)) {
      throw new Error(
        `Updated manifest id "${manifest.id}" does not match installed id "${options.packageId}". ` +
          `Run \`bakin agents remove ${options.packageId}\` then install the new id fresh.`,
      )
    }

    validatePackageContributionIntegrity({
      manifest,
      stagingDir: fetched.stagingDir,
      enabledLessons: entry.kind === 'agent' ? entry.lessonsEnabled ?? [] : undefined,
    })

    const installedAt = entry.installedAt // preserve original install timestamp
    const updatedAt = new Date().toISOString()
    const installedBy = {
      package: stripVersionFromKey(options.packageId),
      version: manifest.version,
      ref: fetched.ref,
      commitSha: fetched.commitSha,
      installedAt: updatedAt,
    }

    // Install the NEW manifest's requirement legs FIRST — before any old
    // state is torn down. Every leg is fail-fast and idempotent (unchanged
    // pins/deps = fast paths, no network), so a bad download/install aborts
    // the whole update here with nothing unprojected and the lockfile
    // untouched.
    const requirementResult = { projections: [] as ProjectionEntry[] }
    const bareId = stripVersionFromKey(options.packageId)
    await installManifestRequirements({
      manifest,
      packId: bareId,
      sourceDir: fetched.stagingDir,
      installedBy,
      result: requirementResult,
    })

    // Roll back the old skill/asset projections so the new ones land on a
    // clean slate. Workspace files are NOT unprojected — the projector
    // rewrites their managed block in place (agent content outside the
    // block is never touched). Legacy lesson-marker entries are likewise
    // left alone (the migration removes them). Requirement targets the NEW
    // manifest still declares were refreshed in place above; only ones the
    // new version dropped get swept — and, like removal, a dropped
    // bin/model another installed pack still projects survives
    // (withoutSharedArtifacts).
    const declaredBinNames = new Set(
      manifest.kind === 'skill-pack' ? (manifest.requires?.bins ?? []).map((b) => b.name) : [],
    )
    const declaredNpmTargets = new Set(
      manifest.kind === 'skill-pack' ? (manifest.requires?.npm ?? []).map((n) => npmPayloadDir(bareId, n.name)) : [],
    )
    const declaredModelTargets = new Set(
      manifest.kind === 'skill-pack' ? (manifest.requires?.models ?? []).map((m) => modelDest(m.dest)) : [],
    )
    if (entry.projections && entry.projections.length > 0) {
      const toUnproject = withoutSharedArtifacts(lock, options.packageId, entry.projections).filter((p) => {
        if (p.kind === 'workspace-file') return false
        if (p.kind === 'lesson-marker') return false
        if (p.kind === 'bin' && declaredBinNames.has(basename(p.target))) return false
        if (p.kind === 'npm-payload' && declaredNpmTargets.has(p.target)) return false
        if (p.kind === 'model' && declaredModelTargets.has(p.target)) return false
        return true
      })
      if (toUnproject.length > 0) {
        await unprojectPackage(toUnproject, { keepBlocks: true })
      }
    }

    const projectionResult = await projectPackage({
      manifest,
      stagingDir: fetched.stagingDir,
      agentId: entry.agentId,
      enabledLessons: entry.lessonsEnabled,
      installedBy,
    })
    projectionResult.projections.push(...requirementResult.projections)

    // Move staging → install dir (rename preserves the package source for
    // future re-load on boot)
    const finalDir = getPackageSourceDir(
      getContentDir(),
      manifest.kind,
      stripVersionFromKey(options.packageId),
      manifest.version,
    )
    mkdirSync(dirname(finalDir), { recursive: true })
    if (existsSync(finalDir)) {
      rmSync(finalDir, { recursive: true, force: true })
    }
    renameSync(fetched.stagingDir, finalDir)

    // Update lockfile entry
    const nextEntry: PackageEntry = {
      ...entry,
      version: manifest.version,
      ref: fetched.ref,
      commitSha: fetched.commitSha,
      installedAt, // unchanged — original install timestamp
      projections: projectionResult.projections,
    }
    writeLockfile(addPackage(lock, options.packageId, nextEntry))

    appendAudit(
      getContentDir(),
      entry.kind === 'agent' ? 'agent_pkg.updated' : 'pkg.updated',
      entry.agentId ?? options.packageId,
      {
        packageId: options.packageId,
        kind: entry.kind,
        fromVersion: entry.version,
        toVersion: manifest.version,
        fromSha: entry.commitSha,
        toSha: fetched.commitSha,
      },
      'cli',
    )

    return {
      packageId: options.packageId,
      changed: true,
      fromCommitSha: entry.commitSha,
      toCommitSha: fetched.commitSha,
      fromVersion: entry.version,
      toVersion: manifest.version,
    }
  } catch (err) {
    if (fetched && existsSync(fetched.stagingDir)) {
      try {
        rmSync(fetched.stagingDir, { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
    }
    throw err
  } finally {
    releaseInstallLock()
  }
}

function stripVersionFromKey(key: string): string {
  const at = key.lastIndexOf('@')
  return at === -1 ? key : key.slice(0, at)
}
