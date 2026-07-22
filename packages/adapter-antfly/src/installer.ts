import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { chmodSync, existsSync, mkdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { SearchAdapterSetupOptions } from '@bakin/core/adapters/search'
import type { AdapterLogger } from '@bakin/core/adapters/shared'
import { DEFAULT_SETTINGS } from './defaults'
import { antflyBinaryPath, antflyHome } from './paths'
import { ANTFLY_PIN, antflyDownloadUrl, antflyPlatformKey, type AntflyPin } from './pin'
import { ensureProvisioned, findAntflyBinary, servicePaths, stopService, startService } from './service'
import { DEFAULT_SETTINGS as SERVICE_DEFAULTS } from './defaults'

/**
 * Direct-download installer for the pinned Antfly release.
 *
 * No package manager involved: download the release tarball from
 * releases.antfly.io, verify its SHA256 against the pin, extract the binary
 * to ~/.antfly/bin/antfly atomically, and verify `antfly --version` matches.
 * Zero toolchain dependencies (no brew/xcode/node/python/sudo).
 */

const noopLogger: AdapterLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

const DOWNLOAD_SIZE_HINT = '~20 MB'

function runCommand(
  cmd: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (err) => reject(err))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

/**
 * Run `antfly --version` and extract the semver-ish token. Returns null when
 * the binary can't be executed or prints nothing recognizable.
 */
export async function antflyBinaryVersion(binary: string): Promise<string | null> {
  try {
    const { code, stdout, stderr } = await runCommand(binary, ['--version'])
    if (code !== 0) return null
    const match = `${stdout}\n${stderr}`.match(/\d+\.\d+\.\d+[-.\w]*/)
    return match ? match[0] : null
  } catch {
    return null
  }
}

async function isLocalServerResponding(): Promise<boolean> {
  try {
    const origin = new URL(DEFAULT_SETTINGS.url).origin
    const res = await fetch(`${origin}/readyz`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

export async function checkAntflyDependency(pin: AntflyPin = ANTFLY_PIN) {
  const binary = findAntflyBinary()
  if (!binary) {
    return {
      name: 'antfly',
      status: 'missing' as const,
      message: 'Antfly binary not found',
      remediation: 'Run `bakin install search` to download the pinned Antfly release.',
    }
  }

  const version = await antflyBinaryVersion(binary)
  if (version === pin.version) {
    return {
      name: 'antfly',
      status: 'ok' as const,
      message: `Antfly v${version} is installed at ${binary}`,
      details: { binary, version },
    }
  }

  return {
    name: 'antfly',
    status: 'error' as const,
    message: version
      ? `Antfly at ${binary} is v${version}, but Bakin needs v${pin.version}`
      : `Antfly at ${binary} did not report a recognizable version`,
    remediation: 'Run `bakin install search` to download the pinned Antfly release.',
    details: { binary, version },
  }
}

export async function installAntflyDependency(
  opts: SearchAdapterSetupOptions,
  logger: AdapterLogger = noopLogger,
  pin: AntflyPin = ANTFLY_PIN,
) {
  const start = Date.now()
  const targetPath = antflyBinaryPath()

  const platformKey = antflyPlatformKey()
  if (!platformKey) {
    return {
      name: 'antfly',
      status: 'failed' as const,
      message: `No prebuilt Antfly binary for ${process.platform}/${process.arch}. Antfly v0.2+ ships darwin-arm64, linux-x64, and linux-arm64 only.`,
      durationMs: Date.now() - start,
    }
  }

  const existing = findAntflyBinary()
  const existingVersion = existing ? await antflyBinaryVersion(existing) : null
  if (existing && existingVersion === pin.version) {
    return {
      name: 'antfly',
      status: 'noop' as const,
      message: `Antfly v${pin.version} is already installed at ${existing}`,
      durationMs: Date.now() - start,
    }
  }

  // An ANTFLY_PATH override outranks the managed install path in discovery,
  // so installing to ~/.antfly/bin would not change what Bakin runs.
  if (existing && existing !== targetPath && process.env.ANTFLY_PATH === existing) {
    return {
      name: 'antfly',
      status: 'failed' as const,
      message: `ANTFLY_PATH points at ${existing} (v${existingVersion ?? 'unknown'}), which is not the pinned v${pin.version}. Unset ANTFLY_PATH or point it at a v${pin.version} binary.`,
      durationMs: Date.now() - start,
    }
  }

  const prompt = existing
    ? `Antfly v${existingVersion ?? 'unknown'} at ${existing} needs to be replaced with v${pin.version}. Download ${DOWNLOAD_SIZE_HINT} from releases.antfly.io?`
    : `Download Antfly v${pin.version} (${DOWNLOAD_SIZE_HINT}) from releases.antfly.io to ${targetPath}?`

  if (opts.interactive && !opts.autoApprove) {
    const proceed = await opts.askYesNo?.(prompt, true)
    if (!proceed) {
      return {
        name: 'antfly',
        status: 'skipped' as const,
        message: 'User declined Antfly install.',
        durationMs: Date.now() - start,
      }
    }
  } else if (!opts.autoApprove) {
    return {
      name: 'antfly',
      status: 'skipped' as const,
      message: 'Non-interactive run without --yes; skipping Antfly install.',
      durationMs: Date.now() - start,
    }
  }

  // Upgrade flow (D3): never swap under a live server — stop the managed
  // service first, swap atomically, restart after. Guest instances are not
  // ours to stop; the responding-check refuses only in that case.
  let restartAfterSwap = false
  if (existing && await isLocalServerResponding()) {
    logger.info('Stopping managed antfly service for binary swap')
    await stopService(SERVICE_DEFAULTS)
    restartAfterSwap = true
    if (await isLocalServerResponding()) {
      return {
        name: 'antfly',
        status: 'failed' as const,
        message: 'An antfly instance is still responding on the private port and is not service-managed. Stop it manually, then re-run `bakin install search`.',
        durationMs: Date.now() - start,
      }
    }
  }

  const url = antflyDownloadUrl(pin, platformKey)
  const expectedChecksum = pin.checksums[platformKey]
  const tmpDir = join(antflyHome(), 'tmp', `install-${process.pid}-${Date.now()}`)

  try {
    logger.info('Downloading Antfly', { url, version: pin.version })
    // A stalled CDN must not hang `bakin install search` forever; ~20MB
    // binary, so 120s covers even a slow link with margin.
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!res.ok) {
      return {
        name: 'antfly',
        status: 'failed' as const,
        message: `Download failed: ${url} responded ${res.status}. Check connectivity, or whether the pinned release still exists upstream.`,
        durationMs: Date.now() - start,
      }
    }
    const bytes = new Uint8Array(await res.arrayBuffer())

    const actualChecksum = createHash('sha256').update(bytes).digest('hex')
    if (actualChecksum !== expectedChecksum) {
      return {
        name: 'antfly',
        status: 'failed' as const,
        message: `Checksum mismatch for ${url}: expected ${expectedChecksum}, got ${actualChecksum}. Refusing to install. The release may have been re-published or tampered with - verify upstream before retrying.`,
        durationMs: Date.now() - start,
      }
    }

    mkdirSync(tmpDir, { recursive: true })
    const archivePath = join(tmpDir, 'antfly.tar.gz')
    writeFileSync(archivePath, bytes)

    const tar = await runCommand('tar', ['-xzf', archivePath, '-C', tmpDir])
    if (tar.code !== 0) {
      return {
        name: 'antfly',
        status: 'failed' as const,
        message: `Failed to extract Antfly archive: tar exited ${tar.code}${tar.stderr ? `: ${tar.stderr.trim()}` : ''}`,
        durationMs: Date.now() - start,
      }
    }

    // Release layout: the binary sits at the archive root alongside share/
    // (the antfarm dashboard assets, which the server resolves relative to
    // the binary as ../share). Install binary -> bin/, share -> home.
    const extractedBinary = join(tmpDir, 'antfly')
    if (!existsSync(extractedBinary)) {
      return {
        name: 'antfly',
        status: 'failed' as const,
        message: 'Antfly archive did not contain the expected antfly binary at its root - the release layout may have changed.',
        durationMs: Date.now() - start,
      }
    }

    // Verify-then-commit: run --version against the extracted binary in the
    // temp dir BEFORE anything is moved into place, so a verification failure
    // leaves the existing install (binary + share/) untouched.
    chmodSync(extractedBinary, 0o755)
    const installedVersion = await antflyBinaryVersion(extractedBinary)
    if (installedVersion !== pin.version) {
      return {
        name: 'antfly',
        status: 'failed' as const,
        message: `Downloaded binary reports v${installedVersion ?? 'unknown'} instead of the pinned v${pin.version}. Nothing was installed.`,
        durationMs: Date.now() - start,
      }
    }

    const extractedShare = join(tmpDir, 'share')
    if (existsSync(extractedShare)) {
      const shareTarget = join(antflyHome(), 'share')
      rmSync(shareTarget, { recursive: true, force: true })
      mkdirSync(dirname(shareTarget), { recursive: true })
      renameSync(extractedShare, shareTarget)
    }

    mkdirSync(dirname(targetPath), { recursive: true })
    renameSync(extractedBinary, targetPath)

    // Engine version change = a deliberate REBUILD event (2026-07-21: the
    // rc.18→rc.21 in-place upgrade silently migrated table files one-way,
    // stalled the data plane for the duration, and made rollback
    // impossible). Search data is derived — clear it and let the repair
    // reindex regenerate the tables instead of trusting an in-place
    // engine-side format migration ever again.
    let dataCleared = false
    if (existing && existingVersion !== pin.version) {
      const dataDir = servicePaths().dataDir
      if (existsSync(dataDir)) {
        logger.info('Engine version changed — clearing derived engine data for a clean rebuild', {
          from: existingVersion ?? 'unknown',
          to: pin.version,
          dataDir,
        })
        rmSync(dataDir, { recursive: true, force: true })
        dataCleared = true
      }
    }

    if (restartAfterSwap) {
      logger.info('Restarting managed antfly service on the new binary')
      // Provision UNCONDITIONALLY before start: the unit's argv must match
      // the binary being installed (a version rollback once left a
      // `standalone` plist driving a `swarm`-era binary — silent no-boot).
      await ensureProvisioned(SERVICE_DEFAULTS)
      await startService(SERVICE_DEFAULTS)
    }
    const durationMs = Date.now() - start
    logger.info('Antfly installed', { binary: targetPath, version: installedVersion, durationMs })
    return {
      name: 'antfly',
      status: 'installed' as const,
      message: dataCleared
        ? `Installed Antfly v${installedVersion} to ${targetPath} (checksum verified). Engine data was cleared for the version change — run \`bakin reindex\` to rebuild the search tables from source.`
        : `Installed Antfly v${installedVersion} to ${targetPath} (checksum verified)`,
      durationMs,
    }
  } catch (err) {
    logger.error('Antfly install failed', err)
    return {
      name: 'antfly',
      status: 'failed' as const,
      message: `Antfly install failed: ${err instanceof Error ? err.message : String(err)}`,
      error: err,
      durationMs: Date.now() - start,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
    // Drop the tmp/ parent too when this was its only occupant.
    try {
      rmdirSync(dirname(tmpDir))
    } catch {
      // Non-empty (a concurrent install) or already gone — both fine.
    }
  }
}
