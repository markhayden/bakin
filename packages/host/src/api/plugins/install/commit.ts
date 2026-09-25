/**
 * Install phase (d) — the commit: copy the staged source into place,
 * compile it (source installs only — never execute a shipped dist/),
 * record the lockfile entry, and live-activate when the registry is up.
 */
import { existsSync, cpSync, rmSync } from 'fs'
import { join, resolve, isAbsolute } from 'path'
import { createLogger } from '@/core/logger'
import { buildUserPlugin } from '../../../plugin-host/user-plugin-builder'
import {
  addPlugin,
  readPluginLockfile,
  writePluginLockfile,
  type PluginLockEntry,
} from '@bakin/core/plugins/lockfile'
import { SOURCE_TREE_SHA_ALGO, computeSourceTreeSha } from '@/core/plugins/source-tree-sha'
import { findSkillsForPlugin } from '@/core/onboarding/plugin-assets'
import { isInstallLockBusy, withInstallLock } from '@/core/install-core/install-lock'
import { replacePluginDir } from '@/core/plugins/replace-transaction'
import { toInstalledBins } from '@/core/agent-packages/bin-installer'
import type { InstallProgressFn } from '@/core/agent-packages/install-progress'
import {
  activateUserPluginDir,
  isLiveActivationUnavailable,
} from '@/core/plugins/live-lifecycle'
import { resolveGitProvenance, type StagedSource } from './resolve-source'
import type { InstallBody } from './body'
import type { ValidatedManifest } from './validate-manifest'

const log = createLogger('plugin-install')

/**
 * FW1.7 — a source install must never execute a dist/ it shipped with;
 * only provenance-verified artifacts skip the rebuild. Deleting the
 * copied dist also closes the freshness-check mtime race (cpSync stamps
 * everything ~now; a tie would skip the compile).
 */
export async function buildSourceInstall(targetDir: string): Promise<void> {
  rmSync(join(targetDir, 'dist'), { recursive: true, force: true })
  await buildUserPlugin(targetDir)
}

/**
 * Write a `PluginLockEntry` for a freshly installed plugin.
 *
 * `manifestSha` is computed by the caller BEFORE the staging→target copy
 * (so the same hash drives both the consent token and this lockfile
 * entry). Previously this function re-read the manifest from
 * `manifestPath` AFTER the staging dir had been deleted — the resulting
 * ENOENT was swallowed by the catch and every install silently returned
 * `ok: true` with no lockfile entry written. That broke consent tokens,
 * `installedSkills`, --check, upgrade, and remove for fresh installs.
 */
export function recordInstall(args: {
  id: string
  targetDir: string
  manifestSha: string
  manifest: Record<string, unknown>
  source: string
  type: 'github' | 'local'
  permissions: PluginLockEntry['permissions']
  gitProvenance?: { ref: string; commitSha: string }
  /** Binaries this install placed (or found identically pinned) — the removal/ownership authority. */
  installedBins?: PluginLockEntry['installedBins']
}): void {
  const { id, targetDir, manifestSha, manifest, source, type } = args
  // A ledger write that fails is a FAILED install: the caller rolls the
  // directory and created bins back. Never swallow it — an installed dir
  // with no ledger row is exactly the orphan state the loader can't explain.
  {
    const { ref, commitSha } = args.gitProvenance ?? resolveGitProvenance(targetDir, type)

    let version: string
    if (typeof manifest.version === 'string' && manifest.version.length > 0) {
      version = manifest.version
    } else {
      log.warn('plugin manifest missing version; defaulting to 0.0.0', { id })
      version = '0.0.0'
    }

    // For local installs, capture the install-time source-tree sha so the
    // first `bakin plugins list --check` doesn't false-positive (the check
    // would compare against an undefined value otherwise).
    let sourceTreeSha: string | undefined
    if (type === 'local' && existsSync(source)) {
      try {
        sourceTreeSha = computeSourceTreeSha(source)
      } catch (err) {
        log.warn('failed to hash local source tree at install', { id, err: String(err) })
      }
    }

    // Record the runtime skills this plugin shipped — used as the
    // authoritative allowlist at uninstall time.
    let installedSkills: string[] = []
    try {
      installedSkills = findSkillsForPlugin({ id, path: targetDir }).map(s => s.name)
    } catch (err) {
      log.warn('failed to scan plugin skills at install', { id, err: String(err) })
    }

    // Permissions are validated up-front by the caller (POST handler) and
    // passed in pre-parsed; recordInstall just records them as-is.
    const entry: PluginLockEntry = {
      source,
      type,
      ref,
      commitSha,
      installedAt: new Date().toISOString(),
      version,
      permissions: args.permissions,
      manifestSha,
      sourceTreeSha,
      ...(sourceTreeSha ? { sourceTreeShaAlgo: SOURCE_TREE_SHA_ALGO } : {}),
      installedSkills,
      ...(args.installedBins?.length ? { installedBins: args.installedBins } : {}),
    }

    const lock = readPluginLockfile()
    writePluginLockfile(addPlugin(lock, id, entry))
  }
}

/**
 * Commit a validated, consented install: copy into `~/.bakin/plugins/<id>/`,
 * tear down staging, build (source installs), record the lockfile entry,
 * and live-activate. Returns the final Response for the request.
 */
export async function commitInstall(args: {
  body: InstallBody
  stagingDir: string
  pluginsRoot: string
  staged: StagedSource
  validated: ValidatedManifest
  progress?: InstallProgressFn
}): Promise<Response> {
  // The whole commit — files, binaries, ledger — is ONE operation under the
  // install lock (reentrant when a job runner already holds it).
  return withInstallLock(() => commitInstallLocked(args))
}

async function commitInstallLocked(args: {
  body: InstallBody
  stagingDir: string
  pluginsRoot: string
  staged: StagedSource
  validated: ValidatedManifest
  progress?: InstallProgressFn
}): Promise<Response> {
  const { body, stagingDir, staged, validated, progress } = args
  const { effectivePluginDir, requestedRef, gitProvenance, installedFromArtifact } = staged
  const { id, manifest, parsedPermissions, stagedManifestSha } = validated

  const recordedSource = body.type === 'local'
    ? (isAbsolute(body.source) ? body.source : resolve(process.cwd(), body.source))
    : body.source
  const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0'

  // ONE transaction: place → build → bins → ledger, restored byte for byte on
  // any failure (replace-transaction.ts). A pre-existing directory under the
  // same id is backed up and comes back if this install fails.
  let targetDir: string
  try {
    const result = await replacePluginDir({
      id,
      op: 'install',
      // Copy from the effective plugin dir (the subpath for monorepo installs,
      // the staging root otherwise). This intentionally drops the rest of the
      // cloned repo + its `.git/` for subpath installs; the subpath upgrade
      // flow re-clones to staging since there's no local `.git/` to fetch into.
      place: (dir) => {
        cpSync(effectivePluginDir, dir, { recursive: true, dereference: false })
        rmSync(stagingDir, { recursive: true, force: true })
      },
      // Compile the plugin to dist/ so the runtime loader and the server-side
      // dynamic import have built artifacts ready. A Whiskit artifact install
      // is already built (dist/ shipped + verified) — FW1.7 skips only those.
      build: installedFromArtifact ? undefined : buildSourceInstall,
      bins: validated.bins,
      binIdentity: { pluginId: id, version, ...(gitProvenance ?? resolveGitProvenance(effectivePluginDir, body.type)) },
      progress,
      ledger: (installedBins) => recordInstall({
        id,
        targetDir: join(args.pluginsRoot, id),
        manifestSha: stagedManifestSha,
        manifest,
        source: recordedSource,
        type: body.type,
        permissions: parsedPermissions,
        gitProvenance,
        installedBins: toInstalledBins(installedBins),
      }),
    })
    targetDir = result.targetDir
  } catch (err) {
    if (isInstallLockBusy(err)) {
      return Response.json({ ok: false, error: `Could not install "${id}": ${err.message}` }, { status: 409 })
    }
    const message = err instanceof Error ? err.message : String(err)
    log.error('Plugin install failed — rolled back', err as Error, { id })
    return Response.json({ ok: false, error: `Could not install "${id}": ${message}` }, { status: 500 })
  }

  let runtimeVersion: number | undefined
  let activated = false
  try {
    const activation = await activateUserPluginDir(targetDir)
    runtimeVersion = activation.runtimeVersion
    activated = true
  } catch (activationErr) {
    if (isLiveActivationUnavailable(activationErr)) {
      log.info('Plugin installed outside a running registry; activation deferred until next start', { id })
    } else {
      const message = activationErr instanceof Error ? activationErr.message : String(activationErr)
      log.error('Plugin install activation failed', activationErr as Error, { id })
      return Response.json({
        ok: false,
        id,
        error: `Installed "${id}" but failed to activate it: ${message}`,
      }, { status: 500 })
    }
  }

  log.info(`Installed plugin "${id}"`, { source: body.source, type: body.type, ref: requestedRef })

  return Response.json({
    ok: true,
    id,
    ...(runtimeVersion !== undefined ? { runtimeVersion } : {}),
    activated,
    message: activated
      ? `Installed "${id}" and activated it.`
      : `Installed "${id}". It will activate on the next Bakin start.`,
  })
}
