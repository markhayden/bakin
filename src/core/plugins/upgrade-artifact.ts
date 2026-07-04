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
import { acquireLock, releaseLock } from '@/core/install-core/install-lock'
import { commitStaging } from '@/core/install-core/transaction'
import {
  type UpgradeOptions,
  type UpgradeResult,
  UpgradeRefusedError,
  auditUpgradeRejected,
  assertManifestIdStable,
  assertManifestSignaturePolicy,
  diffNewPermissions,
  installUpgradedPluginAssets,
  manifestPermissions,
  manifestVersion,
  readManifest,
} from './upgrade-gate'

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
 * Mirrors the live-install path (same lock, same staging, same commit).
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
      awaitingConsent: false,
    }
  }

  const contentDir = getContentDir()
  const lockPath = join(contentDir, 'plugins', '.install.lock')
  const stagingRoot = join(contentDir, '.whiskit-staging')
  const platform = `${process.platform}-${process.arch}`

  acquireLock(lockPath)
  try {
    const materialized = await materializeArtifact(gh.resolver, gh.pluginId, latest, platform, stagingRoot)
    try {
      const { manifest, manifestSha } = readManifest(materialized.stagingDir)
      assertManifestIdStable(manifest, id)
      assertManifestSignaturePolicy(manifest, id)
      const newVersion = manifestVersion(manifest, latest)
      const newCommitSha = materialized.provenance.sourceCommitSha || ''
      const newPerms = manifestPermissions(manifest, id)
      const widened = diffNewPermissions(entry.permissions, newPerms)

      if (widened.length > 0 && !opts.yes) {
        // Consent required — exit BEFORE mutating disk or lockfile.
        return {
          id,
          before,
          after: { version: newVersion, commitSha: newCommitSha },
          noop: false,
          newPermissions: widened,
          awaitingConsent: true,
        }
      }

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

      // Atomic replace of ~/.bakin/plugins/<id> (same-filesystem rename).
      commitStaging(materialized.stagingDir, pluginDir)

      const assets = await installUpgradedPluginAssets(id, pluginDir)

      const updated = updatePlugin(readPluginLockfile(), id, {
        upgradedAt: new Date().toISOString(),
        version: newVersion,
        commitSha: newCommitSha,
        manifestSha,
        permissions: newPerms,
        installedSkills: assets.installedSkills,
        remoteArtifactVersion: latest,
      })
      writePluginLockfile(updated)

      return {
        id,
        before,
        after: { version: newVersion, commitSha: newCommitSha },
        noop: false,
        newPermissions: widened,
        awaitingConsent: false,
        pluginAssets: assets.pluginAssets,
      }
    } finally {
      // commitStaging renamed the extracted dir out on success; this clears
      // the leftover work dir (downloaded tarball) only.
      materialized.cleanup()
    }
  } finally {
    releaseLock(lockPath)
    if (existsSync(stagingRoot)) {
      try {
        rmSync(stagingRoot, { recursive: true, force: true })
      } catch {
        // best-effort
      }
    }
  }
}
