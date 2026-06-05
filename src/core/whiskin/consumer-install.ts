/**
 * Consumer-side artifact materialization (Phase 6).
 *
 * Resolve → download → verify checksum → SAFELY extract into an isolated
 * staging dir → read provenance. This is the toolchain-free install core a
 * non-developer's binary runs: no build, no bun, no git. The caller then
 * validates the manifest + compatibility and publishes the staging dir into
 * ~/.bakin/plugins/<id> via the shared install-core commitStaging (next slice +
 * the live install.ts rewrite).
 */
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { downloadToFile } from './download'
import { safeExtractArtifact, verifyChecksum } from './artifact'
import { readProvenance, PROVENANCE_FILENAME, type WhiskinBuildProvenance } from './provenance'
import type { WhiskinArtifactResolver } from './resolver'

export type WhiskinInstallErrorCode = 'NO_PREBUILT_ARTIFACT'

export class WhiskinInstallError extends Error {
  readonly code: WhiskinInstallErrorCode
  constructor(code: WhiskinInstallErrorCode, message: string) {
    super(message)
    this.name = 'WhiskinInstallError'
    this.code = code
  }
}

export interface MaterializedArtifact {
  /** Isolated dir holding the extracted artifact: bakin-plugin.json, dist/, .whiskin/. */
  stagingDir: string
  provenance: WhiskinBuildProvenance
  /** Remove the materialization work dir (call after publishing or on failure). */
  cleanup: () => void
}

/**
 * Materialize a published artifact: resolve it via the resolver, download it,
 * verify its checksum (throws CHECKSUM_MISMATCH), safe-extract it, and read its
 * provenance. Throws NO_PREBUILT_ARTIFACT when the index has no matching
 * artifact. On any failure the work dir is cleaned up before rethrowing.
 */
export async function materializeArtifact(
  resolver: WhiskinArtifactResolver,
  pluginId: string,
  version: string,
  platform: string,
): Promise<MaterializedArtifact> {
  const location = await resolver.resolve(pluginId, version, platform)
  if (!location) {
    throw new WhiskinInstallError(
      'NO_PREBUILT_ARTIFACT',
      `no published artifact for ${pluginId}@${version} (${platform})`,
    )
  }

  const workDir = mkdtempSync(join(tmpdir(), `whiskin-install-${pluginId}-`))
  const cleanup = () => rmSync(workDir, { recursive: true, force: true })
  try {
    const tarball = join(workDir, 'artifact.tar.gz')
    await downloadToFile(location.artifactUrl, tarball)
    await verifyChecksum(tarball, location.sha256)

    const stagingDir = join(workDir, 'extracted')
    await safeExtractArtifact(tarball, stagingDir)

    const provenance = readProvenance(join(stagingDir, '.whiskin', PROVENANCE_FILENAME))
    return { stagingDir, provenance, cleanup }
  } catch (err) {
    cleanup()
    throw err
  }
}
