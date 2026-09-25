/**
 * Pinned binary installer for capability packs.
 *
 * Installs `requires.bins[]` declarations from a skill-pack manifest into
 * Bakin's own bin dir (`getBakinPaths().bin`, on PATH since server boot —
 * see src/core/secret-env.ts). Modeled on the antfly dependency installer:
 * download with timeout → sha256 verify against the manifest pin (refuse on
 * mismatch) → chmod 0755 → verify-then-commit (run `verifyArgs` against the
 * temp file BEFORE it reaches the target name) → atomic rename. A binary
 * whose on-disk sha already matches the pin is skipped — idempotent installs
 * and shared bins across packs come free.
 *
 * The caller records the returned target as a `bin` lockfile projection, so
 * rollback/uninstall ride the standard projection lifecycle.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs'

import { join } from 'path'
import { tmpdir } from 'os'
import { verifyInstalledBin } from './bin-verify'
import { assertInstallLockHeld } from '../install-core/install-lock'
import { assertNoBinPinConflict, binTargetPath } from '../plugins/bin-owners'
import type { Manifest } from '../../../packages/core/src/agent-packages/manifest'
import type { BinPlatformKey, BinRequirement } from '../../../packages/core/src/plugins/bin-requirement'
import { writeInstalledBy, type InstalledByMarker } from '../../../packages/core/src/agent-packages/markers'
import { commitFileAtomic, downloadToFile, extractTarMember, sha256File } from '../../../packages/core/src/net/download'
import type { ProjectorResult } from './projector'
import { getBakinPaths } from '@/core/content-dir'
import { createLogger } from '@/core/logger'

const log = createLogger('bin-installer')
const execFileAsync = promisify(execFile)

const DOWNLOAD_TIMEOUT_MS = 120_000
const VERIFY_TIMEOUT_MS = 15_000

/** Map this process's platform/arch onto a manifest platform key. */
export function binPlatformKey(): BinPlatformKey | null {
  const os = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : null
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null
  if (!os || !arch) return null
  return `${os}-${arch}` as BinPlatformKey
}

export interface BinInstallResult {
  /** Absolute path of the installed binary inside the Bakin bin dir. */
  target: string
  /** sha256 of the installed bytes (== the manifest pin). */
  sha256: string
  /** True when the on-disk binary already matched the pin — nothing downloaded. */
  skipped: boolean
}

export interface BinInstallOptions {
  /**
   * Fetch implementation. Tests pass Bun.fetch — the happy-dom preload's
   * global fetch cannot drive real sockets.
   */
  fetchImpl?: typeof fetch
  /** Byte progress for the download leg (#895). */
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void
}

export async function installBinRequirement(
  bin: BinRequirement,
  installedBy: Omit<InstalledByMarker, 'sha256'>,
  options: BinInstallOptions = {},
): Promise<BinInstallResult> {
  const platform = binPlatformKey()
  const download = platform ? bin.install[platform] : undefined
  if (!download) {
    throw new Error(
      `Binary "${bin.name}" has no download for this platform (${platform ?? `${process.platform}-${process.arch}`}) — `
      + `declared: ${Object.keys(bin.install).join(', ')}`,
    )
  }

  const binDir = getBakinPaths().bin
  mkdirSync(binDir, { recursive: true })
  const target = join(binDir, bin.name)
  const pin = download.sha256.toLowerCase()

  // Idempotent / shared-bin fast path. Raw downloads: on-disk bytes match
  // the pin. Archives: the pin names the TARBALL, so the marker must match
  // the pin AND the on-disk bytes must match the marker's extracted hash —
  // a corrupted binary under a surviving sidecar still self-heals.
  // ONE predicate with the readiness scan (bin-verify.ts): whatever the
  // doctor would report as installed, the installer skips — and vice versa.
  const verdict = verifyInstalledBin(target, download)
  if (verdict.status === 'installed') {
    log.info(`Binary "${bin.name}" already installed at pinned sha — skipping download`)
    writeInstalledBy(target, { ...installedBy, sha256: pin, ...(download.archive ? { extractedSha256: verdict.onDiskSha256 } : {}) })
    return { target, sha256: pin, skipped: true }
  }

  // Download → (extract) → verify-then-commit all ride the shared primitive
  // (packages/core/src/net/download.ts); this installer keeps only the
  // domain pieces — marker fast path, verify command, lockfile projection.
  const label = `Binary "${bin.name}"`
  const tmp = `${target}.tmp-${process.pid}`
  try {
    if (download.archive) {
      // Archive download: the pin names the TARBALL — verify it, extract the
      // member, and continue the pipeline with ITS bytes.
      const extractDir = mkdtempSync(join(tmpdir(), `bakin-bin-${bin.name}-`))
      try {
        const tarPath = join(extractDir, 'archive.tar.gz')
        await downloadToFile(download.url, tarPath, {
          sha256: pin, timeoutMs: DOWNLOAD_TIMEOUT_MS, fetchImpl: options.fetchImpl, label, onProgress: options.onProgress,
        })
        const memberPath = await extractTarMember(tarPath, download.archive.member, extractDir, {
          timeoutMs: VERIFY_TIMEOUT_MS, label: `${label} archive`,
        })
        copyFileSync(memberPath, tmp)
      } finally {
        rmSync(extractDir, { recursive: true, force: true })
      }
    } else {
      await downloadToFile(download.url, tmp, {
        sha256: pin, timeoutMs: DOWNLOAD_TIMEOUT_MS, fetchImpl: options.fetchImpl, label, onProgress: options.onProgress,
      })
    }

    // Verify-then-commit: the binary must actually run BEFORE it lands under
    // its real name (a broken download must never shadow a working install).
    await commitFileAtomic(tmp, target, {
      mode: 0o755,
      verify: bin.verifyArgs
        ? async (tmpPath) => {
          try {
            await execFileAsync(tmpPath, bin.verifyArgs, { timeout: VERIFY_TIMEOUT_MS })
          } catch (err) {
            throw new Error(
              `${label} verify run failed (${bin.verifyArgs!.join(' ')}): ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
        : undefined,
    })
  } catch (err) {
    try { rmSync(tmp, { force: true }) } catch { /* best-effort tmp cleanup */ }
    throw err
  }

  writeInstalledBy(target, {
    ...installedBy,
    sha256: pin,
    ...(download.archive ? { extractedSha256: await sha256File(target) } : {}),
  })
  log.info(`Installed binary "${bin.name}" ${bin.version} → ${target}`)
  return { target, sha256: pin, skipped: false }
}

/**
 * Install a skill-pack's declared binaries and record them as `bin`
 * projections on the given projector result. Idempotent (pinned-sha
 * fast path), so every projection pass — install, update, local
 * re-projection/repair — MUST call this: bins are part of the pack's
 * projected surface, and any pass that rewrites the lockfile's
 * projections without re-adding bins silently untracks (or, after an
 * unproject sweep, deletes) them.
 */
export async function installManifestBins(
  manifest: Manifest,
  installedBy: Omit<InstalledByMarker, 'sha256'>,
  result: Pick<ProjectorResult, 'projections'>,
  options: { progress?: import('./install-progress').InstallProgressFn } = {},
): Promise<void> {
  if (manifest.kind !== 'skill-pack' || !manifest.requires?.bins?.length) return
  const bins = manifest.requires.bins
  // Every pack writer (install, update, sync/repair) passes through here, so
  // this is where the shared-bin contract is enforced: under the install
  // lock, and never overwriting a target another owner pins differently.
  assertInstallLockHeld('installManifestBins')
  assertNoBinPinConflict(bins, { kind: 'package', id: installedBy.package }, binPlatformKey())
  const progress = options.progress ?? (() => {})
  for (const [index, bin] of bins.entries()) {
    progress({ stage: 'bins', message: `Downloading binary ${bin.name} (${index + 1}/${bins.length})…`, item: bin.name, current: index + 1, total: bins.length })
    const installed = await installBinRequirement(bin, installedBy, {
      onProgress: (receivedBytes, totalBytes) => progress({
        stage: 'bins', message: `Downloading binary ${bin.name} (${index + 1}/${bins.length})…`,
        item: bin.name, current: index + 1, total: bins.length, receivedBytes, totalBytes,
      }),
    })
    result.projections.push({ kind: 'bin', target: installed.target, sha256: installed.sha256 })
  }
}

export interface PluginBinIdentity {
  pluginId: string
  version: string
  /** Git provenance when known; empty strings for local/artifact installs (honest, like packs). */
  ref: string
  commitSha: string
}

export interface PluginBinInstall {
  name: string
  /** Pinned download sha (what the lockfile records). */
  sha256: string
  target: string
  /** False when the pinned file was already in place (shared or re-run) — rollback must not delete it. */
  created: boolean
}

/**
 * Install a plugin's `requires.bins` (spec plugin-managed-binaries §2.6).
 * Same installer, same bin dir, same marker schema as packs — identity
 * `plugin:<id>`. Caller holds the install lock and has already run platform
 * preflight; conflicts are re-checked here because the ledger may have moved.
 */
export async function installPluginBins(
  bins: readonly BinRequirement[],
  identity: PluginBinIdentity,
  options: { progress?: import('./install-progress').InstallProgressFn } = {},
): Promise<PluginBinInstall[]> {
  if (bins.length === 0) return []
  assertInstallLockHeld('installPluginBins')
  assertNoBinPinConflict(bins, { kind: 'plugin', id: identity.pluginId }, binPlatformKey())
  const progress = options.progress ?? (() => {})
  const installedBy: Omit<InstalledByMarker, 'sha256'> = {
    package: `plugin:${identity.pluginId}`,
    version: identity.version,
    ref: identity.ref,
    commitSha: identity.commitSha,
    installedAt: new Date().toISOString(),
  }
  const out: PluginBinInstall[] = []
  for (const [index, bin] of bins.entries()) {
    const message = `Downloading binary ${bin.name} (${index + 1}/${bins.length})…`
    progress({ stage: 'bins', message, item: bin.name, current: index + 1, total: bins.length })
    const installed = await installBinRequirement(bin, installedBy, {
      onProgress: (receivedBytes, totalBytes) => progress({
        stage: 'bins', message, item: bin.name, current: index + 1, total: bins.length, receivedBytes, totalBytes,
      }),
    })
    out.push({ name: bin.name, sha256: installed.sha256, target: binTargetPath(bin.name), created: !installed.skipped })
  }
  return out
}
