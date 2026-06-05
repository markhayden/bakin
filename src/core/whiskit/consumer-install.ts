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
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { downloadToFile } from './download'
import { safeExtractArtifact, verifyChecksum } from './artifact'
import { readProvenance, PROVENANCE_FILENAME, type WhiskitBuildProvenance } from './provenance'
import type { WhiskitArtifactResolver } from './resolver'

export type WhiskitInstallErrorCode = 'NO_PREBUILT_ARTIFACT'

export class WhiskitInstallError extends Error {
  readonly code: WhiskitInstallErrorCode
  constructor(code: WhiskitInstallErrorCode, message: string) {
    super(message)
    this.name = 'WhiskitInstallError'
    this.code = code
  }
}

export interface MaterializedArtifact {
  /** Isolated dir holding the extracted artifact: bakin-plugin.json, dist/, .whiskit/. */
  stagingDir: string
  provenance: WhiskitBuildProvenance
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
  resolver: WhiskitArtifactResolver,
  pluginId: string,
  version: string,
  platform: string,
  /**
   * Root for the materialization work dir. Defaults to the OS temp dir; the
   * live-install layer passes a dir UNDER the content dir so the subsequent
   * commit is a same-filesystem rename (a cross-device rename would EXDEV-fail).
   */
  workRoot: string = tmpdir(),
): Promise<MaterializedArtifact> {
  const location = await resolver.resolve(pluginId, version, platform)
  if (!location) {
    throw new WhiskitInstallError(
      'NO_PREBUILT_ARTIFACT',
      `no published artifact for ${pluginId}@${version} (${platform})`,
    )
  }

  mkdirSync(workRoot, { recursive: true })
  const workDir = mkdtempSync(join(workRoot, `whiskit-install-${pluginId}-`))
  const cleanup = () => rmSync(workDir, { recursive: true, force: true })
  try {
    const tarball = join(workDir, 'artifact.tar.gz')
    await downloadToFile(location.artifactUrl, tarball)
    await verifyChecksum(tarball, location.sha256)

    const stagingDir = join(workDir, 'extracted')
    await safeExtractArtifact(tarball, stagingDir)

    const provenance = readProvenance(join(stagingDir, '.whiskit', PROVENANCE_FILENAME))
    return { stagingDir, provenance, cleanup }
  } catch (err) {
    cleanup()
    throw err
  }
}
