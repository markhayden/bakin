/**
 * Live artifact install (Phase 6) — the toolchain-free consumer install that
 * lands a published plugin into `~/.bakin/plugins/<id>` and records it in the
 * plugin lockfile.
 *
 * Flow: acquire the (now-shared) install lock → materialize the artifact into a
 * staging dir UNDER the content dir (same filesystem, so the commit is an atomic
 * rename) → validate the manifest → check externals-contract compatibility →
 * atomically commit via the shared `commitStaging` → write the lockfile entry.
 * On any failure nothing is committed and the lock is released.
 *
 * This is the consumer half going live. It deliberately reuses the shared
 * install-core primitives (lock + commit) so plugins now get the same
 * concurrency + atomicity guarantees agent packages already had.
 */
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '@/core/content-dir'
import {
  addPlugin,
  readPluginLockfile,
  writePluginLockfile,
  type PluginLockEntry,
} from '@bakin/core/plugins/lockfile'
import { parseManifestPermissions } from '@bakin/core/plugins/permissions'
import { acquireLock, releaseLock } from '@/core/install-core/install-lock'
import { commitStaging } from '@/core/install-core/transaction'
import { materializeArtifact } from './consumer-install'
import { isExternalsContractCompatible } from './provenance'
import type { WhiskitArtifactResolver } from './resolver'

export type LiveInstallErrorCode = 'MANIFEST_MISMATCH' | 'EXTERNALS_CONTRACT_INCOMPATIBLE'

export class LiveInstallError extends Error {
  readonly code: LiveInstallErrorCode
  constructor(code: LiveInstallErrorCode, message: string) {
    super(message)
    this.name = 'LiveInstallError'
    this.code = code
  }
}

export interface InstallArtifactOptions {
  resolver: WhiskitArtifactResolver
  /** Original install source string, recorded in the lockfile. */
  source: string
  pluginId: string
  version: string
  platform: string
}

export interface InstallArtifactResult {
  pluginId: string
  version: string
  installDir: string
}

/**
 * Install a published artifact into the content dir + lockfile. Throws
 * NO_PREBUILT_ARTIFACT / CHECKSUM_MISMATCH (from materialize) or
 * MANIFEST_MISMATCH / EXTERNALS_CONTRACT_INCOMPATIBLE.
 */
export async function installArtifact(opts: InstallArtifactOptions): Promise<InstallArtifactResult> {
  const contentDir = getContentDir()
  const pluginsDir = join(contentDir, 'plugins')
  const lockPath = join(pluginsDir, '.install.lock')
  const stagingRoot = join(contentDir, '.whiskit-staging')

  acquireLock(lockPath)
  try {
    const materialized = await materializeArtifact(
      opts.resolver,
      opts.pluginId,
      opts.version,
      opts.platform,
      stagingRoot,
    )
    try {
      // Validate the manifest in the extracted artifact.
      const manifestPath = join(materialized.stagingDir, 'bakin-plugin.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
        id?: string
        version?: string
        permissions?: unknown
      }
      if (manifest.id !== opts.pluginId) {
        throw new LiveInstallError(
          'MANIFEST_MISMATCH',
          `artifact manifest id "${manifest.id}" does not match requested plugin "${opts.pluginId}"`,
        )
      }

      // The host must still provide the externals the artifact was built for.
      if (!isExternalsContractCompatible(materialized.provenance)) {
        throw new LiveInstallError(
          'EXTERNALS_CONTRACT_INCOMPATIBLE',
          `artifact externals contract "${materialized.provenance.externalsContract}" is not compatible with this host`,
        )
      }

      // Atomic publish into ~/.bakin/plugins/<id> (same-filesystem rename).
      const installDir = join(pluginsDir, opts.pluginId)
      commitStaging(materialized.stagingDir, installDir)

      const entry: PluginLockEntry = {
        source: opts.source,
        type: 'github',
        ref: '',
        commitSha: materialized.provenance.sourceCommitSha || '',
        installedAt: new Date().toISOString(),
        version: materialized.provenance.pluginVersion,
        permissions: parseManifestPermissions(manifest.permissions),
        manifestSha: materialized.provenance.manifestSha,
      }
      writePluginLockfile(addPlugin(readPluginLockfile(), opts.pluginId, entry))

      return { pluginId: opts.pluginId, version: entry.version, installDir }
    } finally {
      // commitStaging renamed the extracted dir out; this clears the leftover
      // work dir (downloaded tarball) only.
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
