/**
 * Whiskit artifact upgrade lane. Artifact installs (carrying
 * `.whiskit/build.json` provenance) check + upgrade by refetching the
 * latest published artifact — never git-clone + rebuild on the consumer's
 * machine.
 */
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '@/core/content-dir'
import {
  type PluginLockEntry,
  readPluginLockfile,
  updatePlugin,
  writePluginLockfile,
} from '@bakin/core/plugins/lockfile'
import { githubArtifactSource } from '@/core/whiskit/github-resolver'
import { downloadText, type TransferOptions } from '@bakin/core/net/download'
import { parseArtifactsIndex, INDEX_FILENAME } from '@/core/whiskit/artifacts-index'
import { artifactRunsOn, artifactUpgradeTarget, hostPlatform, newestCompatibleVersion } from '@/core/whiskit/compatible-version'

export { artifactUpgradeTarget }
import { verifyInstalledArtifact } from '@/core/whiskit/verify'
import { materializeArtifact } from '@/core/whiskit/consumer-install'
import { isExternalsContractCompatible, PROVENANCE_FILENAME } from '@/core/whiskit/provenance'
import { createLogger } from '@/core/logger'
import { moveContents, replacePluginDir } from './replace-transaction'
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
  sweepDroppedBins,
} from './upgrade-gate'

const log = createLogger('plugin-upgrade-artifact')

/**
 * True when the installed plugin dir came from a published Whiskit artifact
 * (carries `.whiskit/build.json` provenance). Such installs check + upgrade
 * through the artifact lane — refetch a published artifact, never git-clone
 * + rebuild on the consumer's machine.
 */
export function isArtifactInstall(pluginDir: string): boolean {
  return existsSync(join(pluginDir, '.whiskit', PROVENANCE_FILENAME))
}

/**
 * Whether the INSTALLED artifact runs on this host — its contract AND its
 * Bakin range (a host rollback can leave a matching contract out of range).
 */
export function installedArtifactRuns(pluginDir: string): boolean {
  const verification = verifyInstalledArtifact(pluginDir)
  return verification.status === 'compatible' && artifactRunsOn(verification.provenance)
}

export interface PublishedVersions {
  pluginId: string
  /** The newest publish, whatever host it targets. */
  latest: string | null
  /** The newest publish THIS host can run (contract + Bakin range), or null. */
  compatible: string | null
}

/** Fetch the published versions for an artifact install's source. */
export async function publishedVersions(source: string, transfer: TransferOptions = {}): Promise<PublishedVersions> {
  const gh = githubArtifactSource(source)
  const index = parseArtifactsIndex(
    JSON.parse(await downloadText(`${gh.baseUrl}/${INDEX_FILENAME}`, transfer)),
  )
  return {
    pluginId: gh.pluginId,
    latest: index.plugins[gh.pluginId]?.latest ?? null,
    compatible: newestCompatibleVersion(index, gh.pluginId, { platform: hostPlatform() })?.version ?? null,
  }
}

/**
 * Upgrade an artifact-installed plugin by refetching the latest published
 * artifact: resolve the immutable index → compare versions → consent-gate
 * the new manifest's permissions → checksum-verify + safe-extract → check
 * externals-contract compatibility → atomically replace the install dir.
 * Runs under the caller's install lock (upgradePlugin).
 */
export async function upgradeArtifact(
  id: string,
  entry: PluginLockEntry,
  pluginDir: string,
  opts: UpgradeOptions,
  before: { version: string; commitSha: string },
): Promise<UpgradeResult> {
  const gh = githubArtifactSource(entry.source)
  const { latest: newest, compatible } = await publishedVersions(entry.source)
  if (!newest) {
    throw new UpgradeRefusedError(
      `${id}: no published artifact found at ${gh.baseUrl}. Remove and reinstall.`,
    )
  }
  if (!compatible) {
    auditUpgradeRejected('externals_contract_incompatible', id, { artifactVersion: newest })
    throw new UpgradeRefusedError(
      `${id}: no published release runs on this Bakin yet (newest is ${newest}). ` +
      'The plugin author has to publish one for this version of Bakin; until then the installed version stays.',
    )
  }
  // The target is the newest release THIS host can run, not the index's
  // `latest` (which may target a newer or different host contract).
  const target = artifactUpgradeTarget(entry.version, installedArtifactRuns(pluginDir), compatible)
  if (!target) {
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

  const contentDir = getContentDir()
  const stagingRoot = join(contentDir, '.whiskit-staging')
  const platform = hostPlatform()

  const latest = target
  const materialized = await materializeArtifact(gh.resolver, gh.pluginId, latest, platform, stagingRoot)
  try {
    const { manifest, manifestSha } = readManifest(materialized.stagingDir)
    assertManifestIdStable(manifest, id)
    assertManifestSignaturePolicy(manifest, id)
    const newVersion = manifestVersion(manifest, latest)
    const newCommitSha = materialized.provenance.sourceCommitSha || ''
    const gate = gateUpgradeConsent({ id, entry, manifest, manifestSha, opts, before, after: { version: newVersion, commitSha: newCommitSha } })
    if (!gate.proceed) return gate.result

    // The host must still provide the externals the new artifact was
    // built for; an incompatible artifact means Bakin itself is behind.
    if (!isExternalsContractCompatible(materialized.provenance)) {
      auditUpgradeRejected('externals_contract_incompatible', id, {
        artifactVersion: latest,
        externalsContract: materialized.provenance.externalsContract,
      })
      throw new UpgradeRefusedError(
        `${id}: published artifact ${latest} targets a different host contract ` +
        `("${materialized.provenance.externalsContract}"). Update Bakin, then retry.`,
      )
    }

    // Consent accepted (or unnecessary). Replace the plugin dir inside the
    // transaction — the previous install (directory, binaries, ledger row)
    // comes back byte for byte on any failure. Bins the new manifest dropped
    // go only AFTER the ledger write, and only with zero remaining owners.
    let assets!: Awaited<ReturnType<typeof installUpgradedPluginAssets>>
    const { installedBins } = await replacePluginDir({
      id,
      op: 'upgrade',
      place: (dir) => moveContents(materialized.stagingDir, dir),
      bins: gate.bins,
      binIdentity: { pluginId: id, version: newVersion, ref: '', commitSha: newCommitSha },
      operation: opts.op,
      ledger: async (bins) => {
        assets = await installUpgradedPluginAssets(id, pluginDir)
        writePluginLockfile(updatePlugin(readPluginLockfile(), id, {
          upgradedAt: new Date().toISOString(),
          version: newVersion,
        commitSha: newCommitSha,
        remoteArtifactVersion: latest,
          remoteArtifactRebuild: false,
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
      after: { version: newVersion, commitSha: newCommitSha },
      noop: false,
      newPermissions: gate.widened,
      newBins: gate.newBins,
      awaitingConsent: false,
      pluginAssets: assets.pluginAssets,
      droppedBins,
    }
  } finally {
    // Clears the work dir (downloaded tarball + whatever the transaction did
    // not move out).
    materialized.cleanup()
    if (existsSync(stagingRoot)) {
      try {
        rmSync(stagingRoot, { recursive: true, force: true })
      } catch (err) {
        log.warn('Could not remove artifact staging root', { stagingRoot, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
}
