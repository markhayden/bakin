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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { tmpdir } from 'os'
import type { BinPlatformKey, BinRequirement, Manifest } from '../../../packages/core/src/agent-packages/manifest'
import { readInstalledBy, writeInstalledBy, type InstalledByMarker } from '../../../packages/core/src/agent-packages/markers'
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
  if (existsSync(target)) {
    const onDisk = createHash('sha256').update(readFileSync(target)).digest('hex')
    const marker = readInstalledBy(target)
    const matches = download.archive
      ? marker?.sha256?.toLowerCase() === pin && marker?.extractedSha256 === onDisk
      : onDisk === pin
    if (matches) {
      log.info(`Binary "${bin.name}" already installed at pinned sha — skipping download`)
      writeInstalledBy(target, { ...installedBy, sha256: pin, ...(download.archive ? { extractedSha256: onDisk } : {}) })
      return { target, sha256: pin, skipped: true }
    }
  }

  // Default to Bun's NATIVE fetch: the server always runs under Bun, and the
  // test preload's happy-dom fetch cannot drive real sockets (CLAUDE.md).
  const fetchImpl = options.fetchImpl
    ?? (Bun as unknown as { fetch?: typeof fetch }).fetch
    ?? fetch
  const res = await fetchImpl(download.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!res.ok) {
    throw new Error(`Binary "${bin.name}" download failed: ${res.status} ${res.statusText} (${download.url})`)
  }
  let bytes = new Uint8Array(await res.arrayBuffer())

  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== pin) {
    throw new Error(
      `Binary "${bin.name}" checksum mismatch: expected ${pin}, got ${actual} — refusing to install (${download.url})`,
    )
  }

  // Archive download: the verified bytes are a tarball — extract the member
  // and continue the pipeline with ITS bytes.
  if (download.archive) {
    const extractDir = mkdtempSync(join(tmpdir(), `bakin-bin-${bin.name}-`))
    const tarPath = join(extractDir, 'archive.tar.gz')
    try {
      writeFileSync(tarPath, bytes)
      // '--' terminates option parsing — a member name can never be read as
      // a tar option (argument-injection hardening; schema also bans '-').
      await execFileAsync('tar', ['-xzf', tarPath, '-C', extractDir, '--', download.archive.member], { timeout: VERIFY_TIMEOUT_MS })
      const memberPath = join(extractDir, download.archive.member)
      if (!existsSync(memberPath)) {
        throw new Error(`member "${download.archive.member}" not found in archive`)
      }
      bytes = new Uint8Array(readFileSync(memberPath))
    } catch (err) {
      throw new Error(
        `Binary "${bin.name}" archive extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      rmSync(extractDir, { recursive: true, force: true })
    }
  }

  const tmp = `${target}.tmp-${process.pid}`
  try {
    writeFileSync(tmp, bytes, { mode: 0o755 })
    chmodSync(tmp, 0o755)

    // Verify-then-commit: the binary must actually run BEFORE it lands under
    // its real name (a broken download must never shadow a working install).
    if (bin.verifyArgs) {
      try {
        await execFileAsync(tmp, bin.verifyArgs, { timeout: VERIFY_TIMEOUT_MS })
      } catch (err) {
        throw new Error(
          `Binary "${bin.name}" verify run failed (${bin.verifyArgs.join(' ')}): ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    renameSync(tmp, target)
  } catch (err) {
    try { rmSync(tmp, { force: true }) } catch { /* best-effort tmp cleanup */ }
    throw err
  }

  writeInstalledBy(target, {
    ...installedBy,
    sha256: pin,
    ...(download.archive ? { extractedSha256: createHash('sha256').update(bytes).digest('hex') } : {}),
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
): Promise<void> {
  if (manifest.kind !== 'skill-pack' || !manifest.requires?.bins?.length) return
  for (const bin of manifest.requires.bins) {
    const installed = await installBinRequirement(bin, installedBy)
    result.projections.push({ kind: 'bin', target: installed.target, sha256: installed.sha256 })
  }
}
