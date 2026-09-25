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
import { downloadText } from '@/core/whiskit/download'
import { parseArtifactsIndex, INDEX_FILENAME } from '@/core/whiskit/artifacts-index'
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

/** Fetch the latest published version for an artifact install's source. */
export async function latestPublishedVersion(source: string): Promise<{ pluginId: string; latest: string | null }> {
  const gh = githubArtifactSource(source)
  const index = parseArtifactsIndex(
    JSON.parse(await downloadText(`${gh.baseUrl}/${INDEX_FILENAME}`)),
  )
  return { pluginId: gh.pluginId, latest: index.plugins[gh.pluginId]?.latest ?? null }
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
  const { latest } = await latestPublishedVersion(entry.source)
  if (!latest) {
    throw new UpgradeRefusedError(
      `${id}: no published artifact found at ${gh.baseUrl}. Remove and reinstall.`,
    )
  }
  if (latest === entry.version) {
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
  const platform = `${process.platform}-${process.arch}`

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
      progress: opts.progress,
      ledger: async (bins) => {
        assets = await installUpgradedPluginAssets(id, pluginDir)
        writePluginLockfile(updatePlugin(readPluginLockfile(), id, {
          upgradedAt: new Date().toISOString(),
          version: newVersion,
        commitSha: newCommitSha,
        remoteArtifactVersion: latest,
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
