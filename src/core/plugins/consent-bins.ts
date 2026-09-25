/**
 * The binary downloads a manifest asks this machine to consent to — ONE
 * projection shared by the install consent gate, the upgrade consent gate
 * and the CLI/UI disclosures (spec plugin-managed-binaries §2.5).
 */
import type { BinRequirement } from '@bakin/core/plugins/bin-requirement'
import { binPlatformKey } from '@/core/agent-packages/bin-installer'
import type { ConsentBin } from './consent-token'

export type { ConsentBin } from './consent-token'

/**
 * One row per declared bin with the sha pinned for the running platform. A
 * bin without a build for this platform still appears (sha '') — preflight
 * refuses it; the user should see what was asked for.
 */
export function consentBinsOf(bins: readonly BinRequirement[] | undefined): ConsentBin[] {
  if (!bins?.length) return []
  const platform = binPlatformKey()
  return bins.map((bin) => {
    const download = platform ? bin.install[platform] : undefined
    return {
      name: bin.name,
      version: bin.version,
      sha256: download?.sha256.toLowerCase() ?? '',
      ...(download?.sizeBytes !== undefined ? { sizeBytes: download.sizeBytes } : {}),
    }
  })
}

/** Same declaration, in order: name + version + pinned sha. */
export function sameBins(a: readonly ConsentBin[], b: readonly ConsentBin[]): boolean {
  if (a.length !== b.length) return false
  return a.every((x, i) => x.name === b[i]!.name && x.version === b[i]!.version && x.sha256 === b[i]!.sha256)
}
