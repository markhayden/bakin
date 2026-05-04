/**
 * Update flow — `bakin agents update <id>` and `bakin packages update <id>`.
 *
 * Refetches the package's source at the same `source` + `ref` recorded in
 * the lockfile, compares the new commit SHA to the recorded one, and
 * re-projects in update mode if they differ. The runtime roster is NOT
 * touched (defaultModel + dispatchableBy are populated only on fresh
 * install per the settled D5 decision — the user controls models through
 * the Models UI from then on).
 *
 * No-op when commit SHAs match — useful so `bakin agents update` can run
 * unconditionally as a doctor companion without spamming writes.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'fs'
import { dirname, join } from 'path'
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
} from '../../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../../packages/core/src/agent-packages/package-paths'
import { fetchSource, type FetchedSource } from './source-fetcher'
import { projectPackage, unprojectPackage } from './projector'
import {
  acquireInstallLock,
  releaseInstallLock,
} from './install-lock'
import { validatePackageLessonIntegrity } from './lesson-integrity'

const log = createLogger('agent-pkg:update')

export interface UpdateOptions {
  packageId: string
  /**
   * When true, rewrite workspace files (SOUL.md/IDENTITY.md/etc.) from the
   * package template even though the agent has been editing them. Always
   * still honored: `.userEdited` sentinels.
   */
  refreshTemplate?: boolean
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
    const sourceWithRef = entry.source.startsWith('github:') && entry.ref
      ? `${entry.source}@${entry.ref}`
      : entry.source
    fetched = fetchSource(sourceWithRef)

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

    // Sanity: id must match. Renaming a package mid-install is too dangerous
    // to allow silently — the user runs remove + install instead.
    if (manifest.id !== stripVersionFromKey(options.packageId)) {
      throw new Error(
        `Updated manifest id "${manifest.id}" does not match installed id "${options.packageId}". ` +
          `Run \`bakin agents remove ${options.packageId}\` then install the new id fresh.`,
      )
    }

    validatePackageLessonIntegrity({
      manifest,
      stagingDir: fetched.stagingDir,
      enabledLessons: entry.kind === 'agent' ? entry.lessonsEnabled ?? [] : undefined,
    })

    // Roll back the old projections so the new ones land on a clean slate.
    // Two carve-outs:
    //   - Workspace files stay unless --refresh-template was passed; the agent
    //     owns them after first install and the new projector will only
    //     re-write under refreshTemplate.
    //   - Lesson markers stay (keepBlocks) because the projector replaces
    //     them in-place via injectBlock; a removeBlock + injectBlock round
    //     trip would briefly drop the catalog block from the agent's SOUL.md.
    if (entry.projections && entry.projections.length > 0) {
      const toUnproject = entry.projections.filter((p) => {
        if (p.kind === 'workspace-file' && !options.refreshTemplate) return false
        if (p.kind === 'lesson-marker') return false
        return true
      })
      if (toUnproject.length > 0) {
        await unprojectPackage(toUnproject, { keepBlocks: true })
      }
    }

    const installedAt = entry.installedAt // preserve original install timestamp
    const updatedAt = new Date().toISOString()
    const installedBy = {
      package: stripVersionFromKey(options.packageId),
      version: manifest.version,
      ref: fetched.ref,
      commitSha: fetched.commitSha,
      installedAt: updatedAt,
    }

    const projectionResult = await projectPackage({
      manifest,
      stagingDir: fetched.stagingDir,
      agentId: entry.agentId,
      mode: 'update',
      refreshTemplate: options.refreshTemplate,
      enabledLessons: entry.lessonsEnabled,
      installedBy,
    })

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
        refreshTemplate: options.refreshTemplate ?? false,
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
