/**
 * Plugin upgrade orchestration (commit C4).
 *
 * `upgradePlugin(id, opts)` re-pulls a user plugin from its recorded source
 * (github fast-forward or local re-cpSync), rebuilds it via buildUserPlugin,
 * and updates the lockfile entry. No-op detection short-circuits when there
 * are no changes to apply.
 *
 * Consent for permission widening is detected here but the prompt itself
 * lands in C9 — for now, callers receive `awaitingConsent: true` with the
 * diff and decide what to do (CLI surfaces a placeholder; --yes overrides).
 *
 * The HTTP endpoint live-activates the rebuilt plugin when the server
 * registry is running.
 *
 * This module stays the public entry point; the lanes live in sibling
 * modules and their shared surface is re-exported here so existing
 * importers (host API routes, CLI, tests) keep a single import path:
 * - `./upgrade-gate` — types, refusal error, consent/manifest gates
 * - `./upgrade-github` — in-place fast-forward + subpath staging-clone lanes
 * - `./upgrade-artifact` — Whiskit published-artifact lane
 * - `./upgrade-check` — the read-only `--check` probe (batched lockfile write)
 * - `./source-tree-sha` — local source-tree hashing
 */
import { existsSync, cpSync, realpathSync, rmSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '@/core/content-dir'
import { isCorePlugin } from '@/core/plugin-registry'
import { assertResourceHeld } from '@bakin/core/operations'
import {
  type PluginLockEntry,
  isLinked,
  readPluginLockfile,
  updatePlugin,
  writePluginLockfile,
} from '@bakin/core/plugins/lockfile'
import { parseGithubSource } from '@bakin/core/plugins/source'
import { buildUserPlugin } from '../../../packages/host/src/plugin-host/user-plugin-builder'
import { SOURCE_TREE_SHA_ALGO, compareStoredSourceTreeSha, computeSourceTreeSha, copyLocalSource, symlinksIn } from './source-tree-sha'
import { replacePluginDir } from './replace-transaction'
import { toInstalledBins } from '@/core/agent-packages/bin-installer'
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
  sweepDroppedBins, assertUpgradeTarget } from './upgrade-gate'
import { isArtifactInstall, upgradeArtifact } from './upgrade-artifact'
import { PLUGIN_STAGES } from './operation-plans'
import { upgradeGithub, upgradeGithubSubpath } from './upgrade-github'

export { type UpgradeConsent, type UpgradeOptions, type UpgradeResult, UpgradeRefusedError } from './upgrade-gate'
export { runChecks, type UpgradeAvailability } from './upgrade-check'
export { isArtifactInstall } from './upgrade-artifact'
export { computeSourceTreeSha } from './source-tree-sha'

/**
 * Upgrade an installed user plugin in-place. Returns a structured result so
 * callers (CLI, API endpoint) can render the right message and decide
 * whether to re-prompt for permission consent.
 */
export async function upgradePlugin(
  id: string,
  opts: UpgradeOptions = {},
): Promise<UpgradeResult> {
  opts.op?.stage(PLUGIN_STAGES.fetch, id)
  // A preview never writes outside staging, so it holds nothing. A commit
  // runs inside the caller's owner of install-state — the lanes' replace
  // transactions and bin writers assert it too.
  if (!opts.previewOnly) assertResourceHeld('install-state', 'upgradePlugin')
  return upgradePluginResolved(id, opts)
}

async function upgradePluginResolved(
  id: string,
  opts: UpgradeOptions,
): Promise<UpgradeResult> {
  if (isCorePlugin(id)) {
    auditUpgradeRejected('core_plugin', id)
    throw new UpgradeRefusedError(
      `cannot upgrade core plugin: ${id}. Core plugins ship with Bakin and are managed via the binary itself.`,
    )
  }

  const lock = readPluginLockfile()
  const entry = lock.plugins[id]
  if (!entry) {
    throw new UpgradeRefusedError(
      `plugin "${id}" is not installed (no lockfile entry). Install it first with: bakin plugins install <source>`,
    )
  }
  if (isLinked(entry)) {
    throw new UpgradeRefusedError(
      `plugin "${id}" is dev-installed from ${entry.linkedSource}; edit the source directly or unlink it first`,
    )
  }

  const pluginsRoot = join(getContentDir(), 'plugins')
  const pluginDir = join(pluginsRoot, id)
  if (!existsSync(pluginDir)) {
    throw new UpgradeRefusedError(
      `plugin "${id}" lockfile entry exists but ~/.bakin/plugins/${id}/ is missing. Reinstall.`,
    )
  }

  const before = { version: entry.version, commitSha: entry.commitSha }
  const { manifest: currentManifest } = readManifest(pluginDir)
  assertManifestIdStable(currentManifest, id)
  assertManifestSignaturePolicy(currentManifest, id)

  if (entry.type === 'github') {
    // Whiskit artifact installs upgrade through the artifact lane:
    // refetch the latest published artifact (toolchain-free — no git, no
    // bun, no SDK on the consumer's machine), never clone + rebuild.
    if (isArtifactInstall(pluginDir)) {
      return upgradeArtifact(id, entry, pluginDir, opts, before)
    }
    // Subpath installs (`github:user/repo#plugins/foo`) leave `pluginDir`
    // without a `.git/`, so the in-place fetch+merge flow below cannot
    // run. Branch to a staging-clone variant in that case.
    const parsed = parseGithubSource(entry.source)
    if (parsed.subpath) {
      return upgradeGithubSubpath(id, entry, pluginDir, parsed.cloneUrl, parsed.subpath, opts, before)
    }
    return upgradeGithub(id, entry, pluginDir, opts, before)
  }
  return upgradeLocal(id, entry, pluginDir, opts, before)
}

async function upgradeLocal(
  id: string,
  entry: PluginLockEntry,
  pluginDir: string,
  opts: UpgradeOptions,
  before: { version: string; commitSha: string },
): Promise<UpgradeResult> {
  const sourcePath = entry.source
  if (!existsSync(sourcePath)) {
    throw new UpgradeRefusedError(
      `Original source path ${sourcePath} no longer exists. Reinstall with: bakin plugins install <new-path>`,
    )
  }

  // Legacy-aware compare: a stored algo-1 sha is verified with the legacy
  // hasher so hasher consolidation never forces a spurious rebuild of an
  // untouched source (see source-tree-sha.ts).
  const cmp = compareStoredSourceTreeSha(entry, sourcePath, pluginDir)
  const newTreeSha = cmp.liveSha
  if (entry.sourceTreeSha && !cmp.changed) {
    if (cmp.needsAlgoMigration) {
      // One-time reset: rewrite the row under the lockfile hasher so the next
      // check/upgrade takes the fast path. Installed provenance only — the
      // updates engine owns "is there something newer" (#1007 B).
      writePluginLockfile(updatePlugin(readPluginLockfile(), id, {
        sourceTreeSha: newTreeSha,
        sourceTreeShaAlgo: SOURCE_TREE_SHA_ALGO,
      }))
    }
    return {
      id,
      before,
      after: before,
      noop: true,
      declaredPermissions: [],
      declaredBins: [],
      awaitingConsent: false,
    }
  }

  // The source is a LIVE directory someone may be editing: snapshot it into
  // private staging first, and read, verify and install exclusively from that
  // snapshot — the digest the identity names is the digest of the bytes that
  // land (review r5 #1). Consent runs against the snapshot; a decline leaves
  // the on-disk plugin (and its lockfile entry) exactly where it was.
  const pluginsRoot = join(getContentDir(), 'plugins')
  const stagingDir = join(pluginsRoot, `.upgrade-staging-${id}-${Date.now()}-${process.pid}`)
  try {
    // A symlinked source ROOT is resolved so the snapshot is a real directory.
    // The snapshot is the install's transfer set (`copyLocalSource` — root
    // dist/node_modules/.git never ride, everything else does) and the digest
    // covers exactly that set; a symlink anywhere inside is refused — the
    // hasher cannot vouch for what a link points at, so the digest would not
    // cover the build's inputs.
    copyLocalSource(realpathSync(sourcePath), stagingDir)
    const links = symlinksIn(stagingDir)
    if (links.length > 0) {
      throw new UpgradeRefusedError(`${id}: the source carries symlinked entries (${links.slice(0, 3).join(', ')}${links.length > 3 ? ', …' : ''}) — a reviewed digest cannot cover them. Materialize them and check again.`)
    }
    const snapshotSha = computeSourceTreeSha(stagingDir)
    const { manifest, manifestSha } = readManifest(stagingDir)
    assertManifestIdStable(manifest, id)
    assertManifestSignaturePolicy(manifest, id)
    const newVersion = manifestVersion(manifest, entry.version)
    // A local source has no commit; its identity is the source-tree digest the
    // update source offered — a tree that moved since the review is refused (review r4 #1).
    const identity = { version: newVersion, digest: snapshotSha }
    assertUpgradeTarget(id, opts.expected, identity)
    const gate = gateUpgradeConsent({ id, entry, manifest, manifestSha, opts, before, after: { version: newVersion, commitSha: '' }, identity })
    if (!gate.proceed) return gate.result

    // Consent accepted (or unnecessary). Replace the plugin dir inside the
    // transaction — the previous install (directory, binaries, ledger row)
    // comes back byte for byte on any failure. Bins the new manifest dropped
    // go only AFTER the ledger write, and only with zero remaining owners.
    let assets!: Awaited<ReturnType<typeof installUpgradedPluginAssets>>
    const { installedBins } = await replacePluginDir({
      id,
      op: 'upgrade',
      place: (dir) => cpSync(stagingDir, dir, { recursive: true, dereference: false }),
      build: buildUserPlugin,
      bins: gate.bins,
      binIdentity: { pluginId: id, version: newVersion, ref: '', commitSha: '' },
      operation: opts.op,
      ledger: async (bins) => {
        assets = await installUpgradedPluginAssets(id, pluginDir)
        writePluginLockfile(updatePlugin(readPluginLockfile(), id, {
          upgradedAt: new Date().toISOString(),
          version: newVersion,
          sourceTreeSha: snapshotSha,
          sourceTreeShaAlgo: SOURCE_TREE_SHA_ALGO,
          manifestSha,
          permissions: gate.newPerms,
          installedSkills: assets.installedSkills,
          installedBins: toInstalledBins(bins),
        }))
      },
    })
    const droppedBins = sweepDroppedBins(id, entry.installedBins, installedBins.map((bin) => bin.name))

    return {
      id,
      before,
      after: { version: newVersion, commitSha: '' },
      noop: false,
      identity,
      declaredPermissions: gate.newPerms,
      declaredBins: gate.declaredBins,
      awaitingConsent: false,
      pluginAssets: assets.pluginAssets,
      droppedBins,
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}
