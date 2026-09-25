/**
 * Install phase (d) — the commit: copy the staged source into place,
 * compile it (source installs only — never execute a shipped dist/),
 * record the lockfile entry, and live-activate when the registry is up.
 */
import { existsSync, cpSync, rmSync, writeFileSync } from 'fs'
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
import { installPluginBins, type PluginBinInstall } from '@/core/agent-packages/bin-installer'
import { withInstallLock } from '@/core/install-core/install-lock'
import { removeInstalledBy } from '@bakin/core/agent-packages/markers'
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

/** Durable transaction sentinel: present ⇒ the install is in flight or died mid-way; the loader must ignore the dir. */
export const INSTALL_SENTINEL = '.bakin-install.json'

interface InstallSentinel {
  startedAt: string
  pid: number
  /** ~/.bakin/bin targets THIS install created — recovery deletes exactly these. */
  createdBins: string[]
}

function writeSentinel(targetDir: string, sentinel: InstallSentinel): void {
  writeFileSync(join(targetDir, INSTALL_SENTINEL), JSON.stringify(sentinel, null, 2), 'utf-8')
}

/** Undo everything this install placed: the plugin dir and the bins it created (never a shared, pre-existing bin). */
export function rollbackInstall(targetDir: string, created: readonly string[]): void {
  for (const target of created) {
    try { rmSync(target, { force: true }) } catch { /* best effort */ }
    try { removeInstalledBy(target) } catch { /* best effort */ }
  }
  rmSync(targetDir, { recursive: true, force: true })
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
  const { body, stagingDir, pluginsRoot, staged, validated, progress } = args
  const { effectivePluginDir, requestedRef, gitProvenance, installedFromArtifact } = staged
  const { id, manifest, parsedPermissions, stagedManifestSha } = validated

  const targetDir = join(pluginsRoot, id)
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true })
  }
  // Copy from the effective plugin dir (the subpath for monorepo
  // installs, the staging root otherwise). This intentionally drops
  // the rest of the cloned repo + its `.git/` for subpath installs;
  // the subpath upgrade flow re-clones to staging since there's no
  // local `.git/` to fetch into.
  cpSync(effectivePluginDir, targetDir, { recursive: true, dereference: false })
  rmSync(stagingDir, { recursive: true, force: true })
  const sentinel: InstallSentinel = { startedAt: new Date().toISOString(), pid: process.pid, createdBins: [] }
  writeSentinel(targetDir, sentinel)

  // Compile the plugin to dist/ so the runtime loader (Phase F) and
  // the server-side dynamic import (plugin-registry) have built
  // artifacts ready on next boot. Failures here are fatal for the
  // install request — shipping an installed-but-unbuilt plugin would
  // crash startup instead of surfacing the error to the user now.
  //
  // A Whiskit artifact install is already built (dist/ shipped + verified),
  // so the build step is skipped entirely.
  if (!installedFromArtifact) {
    try {
      await buildSourceInstall(targetDir)
    } catch (buildErr) {
      // Build failed — clean up the installed files so the install
      // appears atomic from the user's perspective.
      rollbackInstall(targetDir, sentinel.createdBins)
      const message = buildErr instanceof Error ? buildErr.message : String(buildErr)
      log.error('Plugin install build step failed', buildErr as Error, { id })
      return Response.json({
        ok: false,
        error: `Installed "${id}" but failed to build it: ${message}`,
      }, { status: 500 })
    }
  }

  // For local installs, record the resolved absolute source path so the
  // upgrade flow can re-resolve it deterministically from any cwd.
  // Declared binaries (spec §2.6): download + verify into ~/.bakin/bin. Any
  // failure rolls back the directory and every bin THIS install created.
  let installedBins: PluginBinInstall[] = []
  if (validated.bins.length > 0) {
    try {
      const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
      const provenance = gitProvenance ?? resolveGitProvenance(targetDir, body.type)
      installedBins = await installPluginBins(
        validated.bins,
        { pluginId: id, version, ref: provenance.ref, commitSha: provenance.commitSha },
        {
          progress: (update) => { progress?.(update) },
          // Durable as each bin lands: a crash or a later failure rolls back
          // exactly what THIS install created — never a shared, pre-existing bin.
          onInstalled: (installed) => {
            if (installed.created) {
              sentinel.createdBins.push(installed.target)
              writeSentinel(targetDir, sentinel)
            }
          },
        },
      )
    } catch (binErr) {
      rollbackInstall(targetDir, sentinel.createdBins)
      const message = binErr instanceof Error ? binErr.message : String(binErr)
      log.error('Plugin install binary step failed — rolled back', binErr as Error, { id })
      return Response.json({ ok: false, error: `Could not install "${id}": ${message}` }, { status: 500 })
    }
  }

  const recordedSource = body.type === 'local'
    ? (isAbsolute(body.source) ? body.source : resolve(process.cwd(), body.source))
    : body.source
  try {
    recordInstall({
      id,
      targetDir,
      manifestSha: stagedManifestSha,
      manifest,
      source: recordedSource,
      type: body.type,
      permissions: parsedPermissions,
      gitProvenance,
      installedBins: installedBins.map((bin) => ({ name: bin.name, sha256: bin.sha256 })),
    })
  } catch (ledgerErr) {
    rollbackInstall(targetDir, sentinel.createdBins)
    const message = ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr)
    log.error('Plugin install ledger write failed — rolled back', ledgerErr as Error, { id })
    return Response.json({ ok: false, error: `Could not record "${id}" in the plugin ledger: ${message}` }, { status: 500 })
  }
  rmSync(join(targetDir, INSTALL_SENTINEL), { force: true })

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
