/**
 * The ONE "is this pinned binary correctly installed?" predicate.
 *
 * `installBinRequirement` uses it to skip a download that is already in
 * place; the plugin-assets scan, the package sync scan and capability
 * readiness use it to report drift — so a binary the installer would
 * re-download is exactly a binary every surface reports, and vice versa
 * (spec plugin-managed-binaries §2.7).
 *
 *   raw download     installed ⇔ sha256(file) == download.sha256
 *   archive download installed ⇔ sha256(file) == download.archive.extractedSha256
 *
 * The bytes on disk are compared with the MANIFEST pin, never with the
 * `.installedBy` marker: a marker is bookkeeping Bakin wrote itself, so a
 * forged binary under a forged marker must still fail (#898 D). Anything
 * present that fails the rule is `drifted`. Absent is `missing`.
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import type { BinDownload, BinRequirement } from '../../../packages/core/src/plugins/bin-requirement'
import { safeParseManifest } from '../../../packages/core/src/agent-packages/manifest'
import { computeFileSha } from '../../../packages/core/src/agent-packages/markers'
import type { PackageEntry } from '../../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../../packages/core/src/agent-packages/package-paths'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'

const log = createLogger('bin-verify')

export type InstalledBinStatus = 'installed' | 'drifted' | 'missing'

export interface InstalledBinVerdict {
  status: InstalledBinStatus
  /** sha256 of the bytes on disk (present unless missing). */
  onDiskSha256?: string
  /** Why a present target is not `installed`. */
  reason?: 'hash-mismatch' | 'not-a-file' | 'unreadable'
}

/** The sha256 the bytes ON DISK must have: the raw pin, or the archive's extracted-member pin. */
export function expectedBinarySha256(download: Pick<BinDownload, 'sha256' | 'archive'>): string {
  return (download.archive ? download.archive.extractedSha256 : download.sha256).toLowerCase()
}

/**
 * Never throws: a target that is not a regular file (a directory, a socket)
 * or cannot be read is `drifted` with its reason, so every scan keeps an
 * actionable finding and moves on to the next binary.
 */
export function verifyInstalledBin(target: string, download: Pick<BinDownload, 'sha256' | 'archive'>): InstalledBinVerdict {
  if (!existsSync(target)) return { status: 'missing' }
  let onDiskSha256: string
  try {
    if (!statSync(target).isFile()) return { status: 'drifted', reason: 'not-a-file' }
    onDiskSha256 = computeFileSha(target)
  } catch (err) {
    log.warn('Installed binary could not be read for verification', { target, error: err instanceof Error ? err.message : String(err) })
    return { status: 'drifted', reason: 'unreadable' }
  }
  return onDiskSha256 === expectedBinarySha256(download)
    ? { status: 'installed', onDiskSha256 }
    : { status: 'drifted', onDiskSha256, reason: 'hash-mismatch' }
}

/**
 * An installed pack's declared binaries, read from its INSTALLED manifest
 * under ~/.bakin/packages/ — the pins every scan judges the bytes on disk
 * against. A missing, unreadable or invalid manifest (the canonical package
 * parser; e.g. an archive bin installed before `extractedSha256` existed) is `invalid` with
 * the reason: surfaces report it, never treat it as "no bins" (#898 D).
 */
export type InstalledPackBins =
  | { ok: true; bins: BinRequirement[] }
  | { ok: false; reason: string }

export function readInstalledPackBins(kind: PackageEntry['kind'], id: string, version: string): InstalledPackBins {
  const manifestPath = join(getPackageSourceDir(getContentDir(), kind, id, version), 'bakin-package.json')
  if (!existsSync(manifestPath)) return { ok: false, reason: `installed manifest is missing (${manifestPath})` }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch (err) {
    return { ok: false, reason: `installed manifest is unreadable: ${err instanceof Error ? err.message : String(err)}` }
  }
  // The canonical package parser decides — the whole manifest, not just its
  // bins: an installed declaration this Bakin would reject is never green.
  const parsed = safeParseManifest(raw)
  if (!parsed.success) {
    return { ok: false, reason: `installed manifest is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}` }
  }
  return { ok: true, bins: ('requires' in parsed.data ? parsed.data.requires?.bins : undefined) ?? [] }
}
