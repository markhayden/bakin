import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { chmodSync, existsSync, mkdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { SearchAdapterSetupOptions, SearchAdapterSetupCheckResult } from '@bakin/core/adapters/search'
import type { AdapterLogger } from '@bakin/core/adapters/shared'
import { DEFAULT_SETTINGS, type AntflySettings } from './defaults'
import { antflyBinaryPath, antflyHome } from './paths'
import { ANTFLY_PIN, antflyDownloadUrl, antflyPlatformKey, type AntflyPin } from './pin'
import { defaultServiceIo, getServiceAccess, withServiceOperation, findAntflyBinary, servicePaths, stopService, startService, type ServiceIo } from './service'

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

async function isLocalServerResponding(settings: AntflySettings): Promise<boolean> {
  try {
    const origin = new URL(settings.url).origin
    const res = await fetch(`${origin}/readyz`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

/** Bounded post-start readiness gate (#859): poll until the engine answers
 *  or the budget expires. Every path that (re)starts the service MUST gate
 *  on this before reporting success — a green install with a dead engine
 *  is how the 2026-09-19 cutover stranded search. */
async function waitForEngineReady(settings: AntflySettings, budgetMs: number, pollMs = 1_000): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  for (;;) {
    if (await isLocalServerResponding(settings)) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

const ENGINE_DEAD_AFTER_START = (budgetMs: number) =>
  `the engine is not answering after ${Math.round(budgetMs / 1000)}s — the service unit may have failed to load or the engine is crash-looping. ` +
  'Check `~/.bakin/logs/antfly.log` and the supervisor (`launchctl list | grep antfly` / `systemctl --user status bakin-antfly`), then re-run `bakin install search`.'

/**
 * Full clean reset of the engine's DERIVED state: stop the supervised
 * service, wipe the data dir (indexes only — models and source content are
 * untouched), re-provision the unit, and start clean. The one-command
 * escape hatch for a corrupted/wedged engine that survives restarts —
 * assembled by hand eight separate times during the 2026-07-21 field
 * recovery before earning a verb. Callers follow with a repair reindex.
 * Refuses in guest mode: a non-default URL means the engine belongs to
 * someone else (dev-rig lesson, 2026-07-11 hijack incident).
 */
export async function resetAntflyEngineData(
  logger: AdapterLogger = noopLogger,
  settings: AntflySettings = DEFAULT_SETTINGS,
  io: ServiceIo = defaultServiceIo(),
): Promise<{ name: string; status: 'installed' | 'failed'; message: string; durationMs: number; error?: unknown }> {
  const start = Date.now()
  try {
    return await withServiceOperation(settings, io, {}, async () => {
      const dataDir = servicePaths().dataDir
      await stopService(settings, io)
      rmSync(dataDir, { recursive: true, force: true })
      await startService(settings, io)
      if (!await waitForEngineReady(settings, 30_000)) throw new Error(ENGINE_DEAD_AFTER_START(30_000))
      return { name: 'reset', status: 'installed', message: 'Engine reset clean and responding. Run a repair reindex to regenerate search tables from source.', durationMs: Date.now() - start }
    })
  } catch (err) {
    logger.error('Engine reset failed', err)
    return { name: 'reset', status: 'failed', message: `Engine reset failed: ${err instanceof Error ? err.message : String(err)}`, error: err, durationMs: Date.now() - start }
  }
}

export async function checkAntflyDependency(
  pin: AntflyPin = ANTFLY_PIN,
  settings: AntflySettings = DEFAULT_SETTINGS,
  io: ServiceIo = defaultServiceIo(),
): Promise<SearchAdapterSetupCheckResult> {
  const access = getServiceAccess(settings, io)
  if (access.mode === 'guest') return { name: 'antfly', status: 'ok', message: access.detail }
  if (!access.allowed && access.reason !== 'unclaimed-home') {
    return { name: 'antfly', status: 'warn', message: access.detail, remediation: access.detail }
  }
  const binary = findAntflyBinary()
  if (!binary) return { name: 'antfly', status: 'missing', message: 'Antfly binary not found', remediation: 'Run `bakin install search` to download the pinned Antfly release.' }
  const version = await antflyBinaryVersion(binary)
  const details = { binary, version }
  if (binary !== antflyBinaryPath()) return { name: 'antfly', status: 'error', message: `ANTFLY_PATH points at ${binary}, but the service launches ${antflyBinaryPath()}. Unset ANTFLY_PATH for managed search.`, details }
  if (version !== pin.version) return {
    name: 'antfly', status: 'broken', details,
    message: version ? `Antfly at ${binary} is v${version}, but Bakin needs v${pin.version}` : `Antfly at ${binary} did not report a recognizable version`,
    remediation: 'Run `bakin install search` to download the pinned Antfly release.',
  }
  if (!access.allowed) return { name: 'antfly', status: 'missing', message: access.detail, remediation: access.detail, details }
  return { name: 'antfly', status: 'ok', message: `Antfly v${version} is installed at ${binary}`, details }
}

export async function installAntflyDependency(
  opts: SearchAdapterSetupOptions,
  logger: AdapterLogger = noopLogger,
  pin: AntflyPin = ANTFLY_PIN,
  timings: { readyBudgetMs?: number; pollMs?: number; io?: ServiceIo } = {},
  settings: AntflySettings = DEFAULT_SETTINGS,
) {
  // Fresh boots wipe + preload models; 60s covers the slowest observed
  // cold start with headroom. Tests inject tiny budgets.
  const readyBudgetMs = timings.readyBudgetMs ?? 60_000
  const pollMs = timings.pollMs ?? 1_000
  const start = Date.now()
  const io = timings.io ?? defaultServiceIo()
  const failed = (err: unknown) => ({ name: 'antfly', status: 'failed' as const, message: `Antfly install failed: ${err instanceof Error ? err.message : String(err)}`, durationMs: Date.now() - start })
  try {
    const access = getServiceAccess(settings, io)
    if (access.mode === 'guest') return { name: 'antfly', status: 'noop' as const, message: access.detail, durationMs: Date.now() - start }
    if ((!access.allowed && !access.ownership?.claimable) || access.reason === 'busy') return failed(access.detail)
  } catch (err) { return failed(err) }
  const intent = { intent: 'install' as const }
  const finish = async () => {
    await startService(settings, io, intent)
    if (!await waitForEngineReady(settings, readyBudgetMs, pollMs)) throw new Error(ENGINE_DEAD_AFTER_START(readyBudgetMs))
  }
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
  // Discovery overrides must not make a different launch target appear healthy.
  if (existing && existing !== targetPath) return failed(`ANTFLY_PATH points at ${existing}; managed search launches ${targetPath}. Unset ANTFLY_PATH before installing.`)
  if (existing && existingVersion === pin.version) {
    try {
      return await withServiceOperation(settings, io, intent, async () => {
        await stopService(settings, io, intent)
        await finish()
        return { name: 'antfly', status: 'noop' as const, message: `Antfly v${pin.version} is already installed at ${existing}; service provisioned and running. Restart Bakin if it started with search unavailable.`, durationMs: Date.now() - start }
      })
    } catch (err) { return failed(err) }
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

    return await withServiceOperation(settings, io, intent, async () => {
      // Staging is complete. Stop even an unready engine before shared mutations.
      await stopService(settings, io, intent)
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

      await finish()
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
    })
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
