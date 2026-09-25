/**
 * The ONE "is this pinned binary correctly installed?" predicate.
 *
 * `installBinRequirement` uses it to skip a download that is already in
 * place, and the plugin-assets readiness scan uses it to report drift — so a
 * binary the installer would re-download is exactly a binary the doctor
 * reports, and vice versa (spec plugin-managed-binaries §2.7).
 *
 *   raw download     installed ⇔ sha256(file) == pin
 *   archive download installed ⇔ marker.sha256 == pin (the archive)
 *                                 AND marker.member == the requested member
 *                                 AND sha256(file) == marker.extractedSha256
 *
 * Anything present that fails the rule is `drifted` — including a changed
 * executable under an untouched marker. Absent is `missing`.
 */
import { existsSync } from 'fs'
import type { BinDownload } from '../../../packages/core/src/plugins/bin-requirement'
import { computeFileSha, readInstalledBy } from '../../../packages/core/src/agent-packages/markers'

export type InstalledBinStatus = 'installed' | 'drifted' | 'missing'

export interface InstalledBinVerdict {
  status: InstalledBinStatus
  /** sha256 of the bytes on disk (present unless missing). */
  onDiskSha256?: string
  /** Why a present file is not `installed`. */
  reason?: 'hash-mismatch' | 'marker-missing' | 'marker-pin-mismatch' | 'member-mismatch' | 'extracted-hash-mismatch'
}

export function verifyInstalledBin(target: string, download: Pick<BinDownload, 'sha256' | 'archive'>): InstalledBinVerdict {
  if (!existsSync(target)) return { status: 'missing' }
  const onDiskSha256 = computeFileSha(target)
  const pin = download.sha256.toLowerCase()

  if (!download.archive) {
    return onDiskSha256 === pin
      ? { status: 'installed', onDiskSha256 }
      : { status: 'drifted', onDiskSha256, reason: 'hash-mismatch' }
  }

  const marker = readInstalledBy(target)
  if (!marker) return { status: 'drifted', onDiskSha256, reason: 'marker-missing' }
  if (marker.sha256.toLowerCase() !== pin) return { status: 'drifted', onDiskSha256, reason: 'marker-pin-mismatch' }
  // Same archive, different member: another owner's binary is on disk under our name.
  if (marker.member !== download.archive.member) return { status: 'drifted', onDiskSha256, reason: 'member-mismatch' }
  if (marker.extractedSha256 !== onDiskSha256) return { status: 'drifted', onDiskSha256, reason: 'extracted-hash-mismatch' }
  return { status: 'installed', onDiskSha256 }
}
