/**
 * Startup verification of an installed Whiskit artifact (Phase 9).
 *
 * At boot, instead of blindly trusting an installed plugin's dist/, we verify
 * the `.whiskit/build.json` provenance:
 *   - no provenance → legacy/local/dev plugin; not our concern (unchanged path).
 *   - provenance present + externals contract supported → safe to activate.
 *   - provenance present but contract unsupported → the artifact expects a
 *     different family or a newer additive contract than this host provides.
 *     Mark it needs-update rather than activating a plugin that will break at
 *     runtime; the repair is to refetch a compatible published artifact.
 *
 * This is the host-upgrade safety the spec calls for: consumers never rebuild,
 * so an incompatible artifact becomes needs-update, not a silent activation.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import {
  PROVENANCE_FILENAME,
  isExternalsContractCompatible,
  readProvenance,
  type WhiskitBuildProvenance,
} from './provenance'
import { EXTERNALS_CONTRACT } from './externals'

export type ArtifactVerification =
  | { status: 'non-whiskit' }
  | { status: 'compatible'; provenance: WhiskitBuildProvenance }
  | { status: 'needs-update'; reason: string; provenance: WhiskitBuildProvenance }
  | { status: 'invalid'; reason: string }

/**
 * Verify the installed plugin at `pluginDir`. Pure (reads `.whiskit/build.json`
 * only); never throws — a corrupt record returns `invalid`.
 */
export function verifyInstalledArtifact(pluginDir: string): ArtifactVerification {
  const provPath = join(pluginDir, '.whiskit', PROVENANCE_FILENAME)
  if (!existsSync(provPath)) return { status: 'non-whiskit' }

  let provenance: WhiskitBuildProvenance
  try {
    provenance = readProvenance(provPath)
  } catch (err) {
    return { status: 'invalid', reason: err instanceof Error ? err.message : String(err) }
  }

  if (!isExternalsContractCompatible(provenance)) {
    return {
      status: 'needs-update',
      reason: `built for externals contract "${provenance.externalsContract}", but this host provides "${EXTERNALS_CONTRACT}"`,
      provenance,
    }
  }
  return { status: 'compatible', provenance }
}
