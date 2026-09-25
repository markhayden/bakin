/**
 * Github upgrade lanes: in-place fast-forward for whole-repo installs
 * (origin pinned to the lockfile source, force-push refused) and a
 * staging-clone flow for monorepo subpath installs. Consent gates run
 * against the remote/staged manifest BEFORE any working-tree mutation.
 */
import { existsSync, cpSync, rmSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { getContentDir } from '@/core/content-dir'
import {
  type PluginLockEntry,
  readPluginLockfile,
  updatePlugin,
  writePluginLockfile,
} from '@bakin/core/plugins/lockfile'
import { parseGithubSource } from '@bakin/core/plugins/source'
import { buildUserPlugin } from '../../../packages/host/src/plugin-host/user-plugin-builder'
import { replacePluginDir } from './replace-transaction'
import {
  type UpgradeOptions,
  type UpgradeResult,
  UpgradeRefusedError,
  auditUpgradeRejected,
  assertManifestIdStable,
  assertManifestSignaturePolicy,
  gateUpgradeConsent,
  installUpgradedPluginAssets,
  manifestVersion,
  readManifest,
  run,
  sweepDroppedBins,
} from './upgrade-gate'

/**
 * Resolve a stored install source string into a git-clone-friendly URL.
 * Thin wrapper over the shared `parseGithubSource` parser; kept as a
 * named helper so the grep target ("githubCloneUrl") survives across the
 * source-parser refactor for older readers.
 */
export function githubCloneUrl(source: string): string {
  return parseGithubSource(source).cloneUrl
}

/**
 * Read the manifest at `<ref>:bakin-plugin.json` from the cloned git repo
 * without touching the working tree. Used by the github upgrade flow to
 * inspect the remote manifest BEFORE fast-forwarding so the consent gate
 * can short-circuit cleanly when permissions widen.
 *
 * `git show <ref>:<path>` writes the file content to stdout — we capture
 * it and compute the manifestSha from the bytes. Identical to what
 * `readManifest` would compute after a checkout.
 */
function readRemoteManifest(pluginDir: string, ref: string): { manifest: Record<string, unknown>; manifestSha: string } {
  const raw = run('git', ['show', `origin/${ref}:bakin-plugin.json`], pluginDir)
  if (!raw) {
    throw new UpgradeRefusedError(`origin/${ref} has no bakin-plugin.json`)
  }
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(raw)
  } catch (err) {
    throw new UpgradeRefusedError(
      `origin/${ref}/bakin-plugin.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const manifestSha = createHash('sha256').update(raw, 'utf-8').digest('hex')
  return { manifest, manifestSha }
}

export async function upgradeGithub(
  id: string,
  entry: PluginLockEntry,
  pluginDir: string,
  opts: UpgradeOptions,
  before: { version: string; commitSha: string },
): Promise<UpgradeResult> {
  if (!entry.ref) {
    throw new UpgradeRefusedError(
      `${id}: lockfile is missing the git ref. Reinstall.`,
    )
  }

  // Pin `origin` to the lockfile-recorded source URL BEFORE fetching.
  // Otherwise a malicious already-activated plugin can rewrite its own
  // `.git/config` `origin` to point at attacker.com and the next user-
  // initiated upgrade silently pulls + builds attacker code (no consent
  // prompt fires when permissions are unchanged). The lockfile is the
  // source of truth for what the user originally installed; reset every
  // time so any in-place tampering is overridden.
  const expectedUrl = githubCloneUrl(entry.source)
  run('git', ['remote', 'set-url', 'origin', '--', expectedUrl], pluginDir)

  // Read-only fetch — updates `.git/` but does not touch the working tree.
  // This lets us inspect the remote manifest before deciding whether to
  // commit the upgrade (consent gate runs against the remote state, not a
  // post-mutation working tree).
  run('git', ['fetch', 'origin', '--', entry.ref], pluginDir)

  const remoteSha = run('git', ['rev-parse', `origin/${entry.ref}`], pluginDir).toLowerCase()
  const localSha = run('git', ['rev-parse', 'HEAD'], pluginDir).toLowerCase()

  // True noop — local HEAD already matches remote AND lockfile commitSha
  // is in sync. Nothing on disk or in the lockfile needs to change.
  if (localSha === remoteSha && entry.commitSha === remoteSha) {
    return {
      id,
      before,
      after: before,
      noop: true,
      newPermissions: [],
      newBins: [],
      awaitingConsent: false,
    }
  }

  // Read the remote manifest WITHOUT mutating the working tree. Consent gate
  // runs against this. If the user declines, no disk change happens.
  const { manifest, manifestSha } = readRemoteManifest(pluginDir, entry.ref)
  assertManifestIdStable(manifest, id)
  assertManifestSignaturePolicy(manifest, id)
  const newVersion = manifestVersion(manifest, entry.version)
  const gate = gateUpgradeConsent({ id, entry, manifest, manifestSha, opts, before, after: { version: newVersion, commitSha: remoteSha } })
  if (!gate.proceed) return gate.result

  // The merge-base check runs BEFORE the transaction (read-only on the
  // fetched objects) so a force-push refusal never touches the working tree.
  if (localSha !== remoteSha) {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', localSha, remoteSha], {
        cwd: pluginDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024,
      })
    } catch {
      auditUpgradeRejected('force_push_detected', id, {
        ref: entry.ref,
        localSha,
        remoteSha,
      })
      throw new UpgradeRefusedError(
        `${id}: cannot fast-forward (remote history rewritten?). Remove and reinstall.`,
      )
    }
  }

  // Consent accepted (or unnecessary). Replace the plugin dir inside the
  // transaction — the previous install (directory, binaries, ledger row)
  // comes back byte for byte on any failure. Bins the new manifest dropped
  // go only AFTER the ledger write, and only with zero remaining owners.
  let assets!: Awaited<ReturnType<typeof installUpgradedPluginAssets>>
  const { installedBins } = await replacePluginDir({
    id,
    op: 'upgrade',
    place: (dir, previousDir) => {
    // In-place lane: the new tree is the OLD clone (with the fetched
    // objects) fast-forwarded — copy the backup in and merge on top.
    cpSync(previousDir!, dir, { recursive: true, dereference: false })
    if (localSha !== remoteSha) run('git', ['merge', '--ff-only', `origin/${entry.ref}`], dir)
  },
  build: buildUserPlugin,
    bins: gate.bins,
    binIdentity: { pluginId: id, version: newVersion, ref: entry.ref, commitSha: remoteSha },
    progress: opts.progress,
    ledger: async (bins) => {
      assets = await installUpgradedPluginAssets(id, pluginDir)
      writePluginLockfile(updatePlugin(readPluginLockfile(), id, {
        upgradedAt: new Date().toISOString(),
        version: newVersion,
      commitSha: remoteSha,
        manifestSha,
        permissions: gate.newPerms,
        installedSkills: assets.installedSkills,
        installedBins: bins.length > 0 ? bins.map((bin) => ({ name: bin.name, sha256: bin.sha256 })) : undefined,
      }))
    },
  })
  const droppedBins = sweepDroppedBins(id, entry.installedBins, installedBins.map((bin) => bin.name))

  return {
    id,
    before,
    after: { version: newVersion, commitSha: remoteSha },
    noop: false,
    newPermissions: gate.widened,
    newBins: gate.newBins,
    awaitingConsent: false,
    pluginAssets: assets.pluginAssets,
    droppedBins,
  }
}

/**
 * Upgrade a github-source plugin installed from a monorepo subpath
 * (`github:user/repo#plugins/foo`). The on-disk plugin dir does not
 * contain `.git/` (only the subpath contents were copied at install
 * time), so the in-place `git fetch`+`git merge` flow used by
 * `upgradeGithub` cannot apply here. Instead: clone the source repo
 * fresh into a staging dir, read the subpath manifest, run the same
 * consent gate, then replace `pluginDir` with the subpath contents.
 *
 * Staging dir is always cleaned up — success path, consent decline path,
 * and exception path — via the `finally` block below.
 */
export async function upgradeGithubSubpath(
  id: string,
  entry: PluginLockEntry,
  pluginDir: string,
  cloneUrl: string,
  subpath: string,
  opts: UpgradeOptions,
  before: { version: string; commitSha: string },
): Promise<UpgradeResult> {
  if (!entry.ref) {
    throw new UpgradeRefusedError(
      `${id}: lockfile is missing the git ref. Reinstall.`,
    )
  }

  const pluginsRoot = join(getContentDir(), 'plugins')
  const stagingDir = join(pluginsRoot, `.upgrade-staging-${id}-${Date.now()}-${process.pid}`)

  try {
    // `--` ends git option parsing; cloneUrl was Zod-validated upstream
    // and re-validated by parseGithubSource, but defense-in-depth.
    execFileSync(
      'git',
      ['clone', '--depth', '1', '--branch', entry.ref, '--', cloneUrl, stagingDir],
      { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 },
    )

    const remoteSha = run('git', ['rev-parse', 'HEAD'], stagingDir).toLowerCase()

    // Noop fast-path — remote hasn't moved since last install/upgrade.
    if (remoteSha === entry.commitSha) {
      return {
        id,
        before,
        after: before,
        noop: true,
        newPermissions: [],
        newBins: [],
        awaitingConsent: false,
      }
    }

    const subpathDir = join(stagingDir, subpath)
    if (!existsSync(subpathDir)) {
      throw new UpgradeRefusedError(
        `${id}: subpath "${subpath}" no longer exists in ${cloneUrl}@${entry.ref}. ` +
        `The monorepo layout may have changed; remove and reinstall.`,
      )
    }
    if (!existsSync(join(subpathDir, 'bakin-plugin.json'))) {
      throw new UpgradeRefusedError(
        `${id}: subpath "${subpath}" no longer contains bakin-plugin.json. Remove and reinstall.`,
      )
    }

    const { manifest, manifestSha } = readManifest(subpathDir)
    assertManifestIdStable(manifest, id)
    assertManifestSignaturePolicy(manifest, id)
    const newVersion = manifestVersion(manifest, entry.version)
    const gate = gateUpgradeConsent({ id, entry, manifest, manifestSha, opts, before, after: { version: newVersion, commitSha: remoteSha } })
    if (!gate.proceed) return gate.result

    // Consent accepted (or unnecessary). Replace the plugin dir inside the
    // transaction — the previous install (directory, binaries, ledger row)
    // comes back byte for byte on any failure. Bins the new manifest dropped
    // go only AFTER the ledger write, and only with zero remaining owners.
    let assets!: Awaited<ReturnType<typeof installUpgradedPluginAssets>>
    const { installedBins } = await replacePluginDir({
      id,
      op: 'upgrade',
      place: (dir) => cpSync(subpathDir, dir, { recursive: true, dereference: false }),
    build: buildUserPlugin,
      bins: gate.bins,
      binIdentity: { pluginId: id, version: newVersion, ref: entry.ref, commitSha: remoteSha },
      progress: opts.progress,
      ledger: async (bins) => {
        assets = await installUpgradedPluginAssets(id, pluginDir)
        writePluginLockfile(updatePlugin(readPluginLockfile(), id, {
          upgradedAt: new Date().toISOString(),
          version: newVersion,
        commitSha: remoteSha,
          manifestSha,
          permissions: gate.newPerms,
          installedSkills: assets.installedSkills,
          installedBins: bins.length > 0 ? bins.map((bin) => ({ name: bin.name, sha256: bin.sha256 })) : undefined,
        }))
      },
    })
    const droppedBins = sweepDroppedBins(id, entry.installedBins, installedBins.map((bin) => bin.name))

    return {
      id,
      before,
      after: { version: newVersion, commitSha: remoteSha },
      noop: false,
      newPermissions: gate.widened,
      newBins: gate.newBins,
      awaitingConsent: false,
      pluginAssets: assets.pluginAssets,
      droppedBins,
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}
