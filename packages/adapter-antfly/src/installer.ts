import { spawn } from 'child_process'
import { chmodSync, existsSync, mkdirSync, renameSync, rmdirSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import type { OperationContext, OperationPlan } from '@makinbakin/sdk/types'
import type { SearchAdapterSetupCheckOptions, SearchAdapterSetupOptions, SearchAdapterSetupCheckResult } from '@bakin/core/adapters/search'
import type { AdapterLogger } from '@bakin/core/adapters/shared'
import { commitFileAtomic, DownloadChecksumError, downloadToFile, extractTarball, opTransfer } from '@bakin/core/net/download'
import { DEFAULT_SETTINGS, type AntflySettings } from './defaults'
import { fileFact, identityOf } from './identity'
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

/**
 * The engine install as an operation (#895). Everything before `commit`
 * happens in a private tmp dir, so cancel is safe until the service stops
 * for the swap.
 */
export const ANTFLY_ENGINE_PLAN: OperationPlan = {
  stages: [
    { id: 'prepare', kind: 'preparing', label: 'Check the engine' },
    { id: 'download', kind: 'downloading', label: 'Download the pinned engine' },
    { id: 'checksum', kind: 'verifying', label: 'Verify the checksum' },
    { id: 'extract', kind: 'extracting', label: 'Unpack the engine' },
    { id: 'version', kind: 'verifying', label: 'Verify the engine version' },
    { id: 'commit', kind: 'committing', label: 'Stop the service and swap the engine' },
    { id: 'cleanup', kind: 'cleanup', label: 'Clear engine data for a version change' },
    { id: 'ready', kind: 'verifying', label: 'Wait for the engine to answer' },
  ],
  pointOfNoReturn: 'commit',
}

/** How long `antfly --version` may take before the probe gives up (and kills the child). */
export const VERSION_PROBE_TIMEOUT_MS = 15_000
const KILL_GRACE_MS = 2_000

export interface RunCommandOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Run a child to completion. On the deadline or an abort the child is
 * killed (SIGTERM, then SIGKILL after a grace) and REAPED — the promise
 * settles only once `close` fired, so a hung executable never outlives the
 * caller's slot (#1007, D7.5/R6).
 */
/** The child was killed by the deadline or the caller's signal: the probe did not finish — it did not answer. */
export class CommandInterruptedError extends Error {
  constructor(message: string, readonly reason: 'timeout' | 'abort') {
    super(message)
    this.name = 'CommandInterruptedError'
  }
}

export function runCommand(
  cmd: string,
  args: string[],
  opts: RunCommandOptions = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let killedBy: Error | null = null
    let killTimer: ReturnType<typeof setTimeout> | null = null
    let forceTimer: ReturnType<typeof setTimeout> | null = null
    const cleanup = (): void => {
      if (killTimer) clearTimeout(killTimer)
      if (forceTimer) clearTimeout(forceTimer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
    const kill = (reason: Error): void => {
      if (killedBy) return
      killedBy = reason
      child.kill('SIGTERM')
      forceTimer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already gone */ } }, KILL_GRACE_MS)
      forceTimer.unref?.()
    }
    const onAbort = (): void => {
      const reason = opts.signal?.reason
      kill(new CommandInterruptedError(reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : `${cmd} ${args.join(' ')} aborted`, 'abort'))
    }
    if (opts.signal?.aborted) onAbort()
    else opts.signal?.addEventListener('abort', onAbort, { once: true })
    if (opts.timeoutMs !== undefined) {
      killTimer = setTimeout(() => kill(new CommandInterruptedError(`${cmd} ${args.join(' ')} did not finish within ${Math.round(opts.timeoutMs! / 1000)}s`, 'timeout')), opts.timeoutMs)
      killTimer.unref?.()
    }
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (err) => { cleanup(); reject(err) })
    child.on('close', (code) => {
      cleanup()
      if (killedBy) reject(killedBy)
      else resolve({ code, stdout, stderr })
    })
  })
}

/**
 * Run `antfly --version` and extract the semver-ish token. Returns null when
 * the binary ran and printed nothing recognizable (or failed to start). A
 * probe the deadline or the caller's signal INTERRUPTED throws instead: it
 * did not answer, and "did not answer" must never read as "wrong version".
 */
export async function antflyBinaryVersion(binary: string, opts: SearchAdapterSetupCheckOptions = {}): Promise<string | null> {
  try {
    const { code, stdout, stderr } = await runCommand(binary, ['--version'], { signal: opts.signal, timeoutMs: VERSION_PROBE_TIMEOUT_MS })
    if (code !== 0) return null
    const match = `${stdout}\n${stderr}`.match(/\d+\.\d+\.\d+[-.\w]*/)
    return match ? match[0] : null
  } catch (err) {
    if (err instanceof CommandInterruptedError) throw err
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
  op: OperationContext,
  logger: AdapterLogger = noopLogger,
  settings: AntflySettings = DEFAULT_SETTINGS,
  io: ServiceIo = defaultServiceIo(),
): Promise<{ name: string; status: 'installed' | 'failed'; message: string; durationMs: number; error?: unknown }> {
  if (!op.holds('search-engine')) throw new Error('resetAntflyEngineData requires search-engine (run it inside an operation that declares it)')
  const start = Date.now()
  try {
    return await withServiceOperation(settings, io, {}, async () => {
      const dataDir = servicePaths().dataDir
      op.stage('stop')
      await stopService(settings, io)
      op.stage('wipe')
      rmSync(dataDir, { recursive: true, force: true })
      op.stage('boot')
      await startService(settings, io)
      if (!await waitForEngineReady(settings, 30_000)) throw new Error(ENGINE_DEAD_AFTER_START(30_000))
      return { name: 'reset', status: 'installed', message: 'Engine reset clean and responding.', durationMs: Date.now() - start }
    })
  } catch (err) {
    logger.error('Engine reset failed', err)
    return { name: 'reset', status: 'failed', message: `Engine reset failed: ${err instanceof Error ? err.message : String(err)}`, error: err, durationMs: Date.now() - start }
  }
}

/**
 * The engine's installed identity (D7.9, R5′): the version it reports plus
 * the binary's path, size and mtime — the installer publishes by rename, so
 * there is no receipt and these stat facts ARE the identity. Opaque to core.
 */
function engineIdentity(binary: string, version: string | null): SearchAdapterSetupCheckResult['installed'] {
  const fact = fileFact(binary)
  return {
    ...(version ? { version } : {}),
    identity: identityOf({ version, binary, size: fact?.size ?? null, mtimeMs: fact?.mtimeMs ?? null }),
  }
}

export async function checkAntflyDependency(
  pin: AntflyPin = ANTFLY_PIN,
  settings: AntflySettings = DEFAULT_SETTINGS,
  io: ServiceIo = defaultServiceIo(),
  opts: SearchAdapterSetupCheckOptions = {},
): Promise<SearchAdapterSetupCheckResult> {
  const access = getServiceAccess(settings, io)
  const required = { version: pin.version }
  if (access.mode === 'guest') return { name: 'antfly', status: 'ok', message: access.detail, applicable: false }
  if (!access.allowed && access.reason !== 'unclaimed-home') {
    return { name: 'antfly', status: 'warn', message: access.detail, remediation: access.detail, applicable: false }
  }
  const binary = findAntflyBinary()
  if (!binary) return { name: 'antfly', status: 'missing', message: 'Antfly binary not found', remediation: 'Run `bakin install search` to download the pinned Antfly release.', applicable: true, required }
  const version = await antflyBinaryVersion(binary, opts)
  const details = { binary, version }
  const installed = engineIdentity(binary, version)
  const base = { applicable: true as const, installed, required }
  if (binary !== antflyBinaryPath()) return { name: 'antfly', status: 'error', message: `ANTFLY_PATH points at ${binary}, but the service launches ${antflyBinaryPath()}. Unset ANTFLY_PATH for managed search.`, details, ...base }
  if (version !== pin.version) return {
    name: 'antfly', status: 'broken', details, ...base,
    message: version ? `Antfly at ${binary} is v${version}, but Bakin needs v${pin.version}` : `Antfly at ${binary} did not report a recognizable version`,
    remediation: 'Run `bakin install search` to download the pinned Antfly release.',
  }
  if (!access.allowed) return { name: 'antfly', status: 'missing', message: access.detail, remediation: access.detail, details, ...base }
  return { name: 'antfly', status: 'ok', message: `Antfly v${version} is installed at ${binary}`, details, ...base }
}

/**
 * The two filesystem steps of the commit, injectable so a test can make one
 * of them fail deterministically (no chmod tricks — those cannot fail as
 * root). Defaults: fs.renameSync and the shared commitFileAtomic.
 */
export interface InstallerFs {
  renameDirectory?: (from: string, to: string) => void
  commitFile?: typeof commitFileAtomic
}

/**
 * A leftover `share.previous` is the only copy of the previous assets after an
 * interrupted install — refused, never deleted, and BEFORE the service is
 * touched on either path (upgrade or already-at-pin). The operator decides
 * with the version rule: a binary that reports the pin means the new install
 * is complete and the aside can go; otherwise restore it and reinstall.
 */
function refuseLeftoverAside(shareAside: string, shareTarget: string, targetPath: string, pinVersion: string): void {
  if (!existsSync(shareAside)) return
  throw new Error(
    `${shareAside} exists from an interrupted install. If \`${targetPath} --version\` reports v${pinVersion} the new install is complete — delete ${shareAside}; otherwise restore it over ${shareTarget} and reinstall.`,
  )
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export async function installAntflyDependency(
  opts: SearchAdapterSetupOptions,
  logger: AdapterLogger = noopLogger,
  pin: AntflyPin = ANTFLY_PIN,
  timings: { readyBudgetMs?: number; pollMs?: number; io?: ServiceIo; installerFs?: InstallerFs } = {},
  settings: AntflySettings = DEFAULT_SETTINGS,
) {
  const fsOps: Required<InstallerFs> = { renameDirectory: renameSync, commitFile: commitFileAtomic, ...timings.installerFs }
  // Fresh boots wipe + preload models; 60s covers the slowest observed
  // cold start with headroom. Tests inject tiny budgets.
  const readyBudgetMs = timings.readyBudgetMs ?? 60_000
  const pollMs = timings.pollMs ?? 1_000
  const { op } = opts
  if (!op.holds('search-engine')) throw new Error('installAntflyDependency requires search-engine (run it inside an operation that declares it)')
  const skip = (stageIds: string[], reason: string) => {
    for (const id of stageIds) op.skip(id, reason)
  }
  const ALL = ANTFLY_ENGINE_PLAN.stages.map((stage) => stage.id)
  const STAGING = ['download', 'checksum', 'extract', 'version']
  const start = Date.now()
  op.stage('prepare')
  const io = timings.io ?? defaultServiceIo()
  const failed = (err: unknown) => {
    // A cancel accepted before the failure settles cancelled, not failed.
    op.throwIfCancelled()
    return { name: 'antfly', status: 'failed' as const, message: `Antfly install failed: ${err instanceof Error ? err.message : String(err)}`, durationMs: Date.now() - start }
  }
  try {
    const access = getServiceAccess(settings, io)
    if (access.mode === 'guest') {
      skip(ALL, 'the engine is managed elsewhere')
      return { name: 'antfly', status: 'noop' as const, message: access.detail, durationMs: Date.now() - start }
    }
    if ((!access.allowed && (!access.ownership?.claimable || (access.reason !== 'unclaimed-home' && !opts.allowServiceClaim))) || access.reason === 'busy') return failed(access.detail)
  } catch (err) { return failed(err) }
  const intent = { intent: opts.allowServiceClaim ? 'install' as const : 'setup' as const }
  const finish = async () => {
    await startService(settings, io, intent)
    op.stage('ready')
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
  const existingVersion = existing ? await antflyBinaryVersion(existing, { signal: op.signal }) : null
  // Discovery overrides must not make a different launch target appear healthy.
  if (existing && existing !== targetPath) return failed(`ANTFLY_PATH points at ${existing}; managed search launches ${targetPath}. Unset ANTFLY_PATH before installing.`)
  if (existing && existingVersion === pin.version) {
    try {
      skip(STAGING, `already at v${pin.version}`)
      return await withServiceOperation(settings, io, intent, async () => {
        if (await antflyBinaryVersion(targetPath, { signal: op.signal }) !== pin.version) throw new Error('The shared engine binary changed during installation. Retry bakin install search.')
        refuseLeftoverAside(`${join(antflyHome(), 'share')}.previous`, join(antflyHome(), 'share'), targetPath, pin.version)
        op.stage('commit', 'Restart the service')
        await stopService(settings, io, intent)
        op.skip('cleanup', 'engine version unchanged')
        await finish()
        return { name: 'antfly', status: 'noop' as const, message: `Antfly v${pin.version} is already installed at ${existing}; service provisioned and running. Restart Bakin if it started with search unavailable.`, durationMs: Date.now() - start }
      })
    } catch (err) { return failed(err) }
  }

  if (!opts.autoApprove) {
    skip(ALL.slice(1), 'not approved')
    return {
      name: 'antfly',
      status: 'skipped' as const,
      message: `Antfly v${pin.version} install not approved (${DOWNLOAD_SIZE_HINT} download from releases.antfly.io).`,
      durationMs: Date.now() - start,
    }
  }

  const url = antflyDownloadUrl(pin, platformKey)
  const expectedChecksum = pin.checksums[platformKey]
  const tmpDir = join(antflyHome(), 'tmp', `install-${process.pid}-${Date.now()}`)

  try {
    logger.info('Downloading Antfly', { url, version: pin.version })
    // Streams to disk through the shared primitive: stall guard, attempt
    // deadline (~20MB binary, so 120s covers even a slow link), one fresh
    // retry, and the sha256 pin verified before anything is extracted.
    mkdirSync(tmpDir, { recursive: true })
    const archivePath = join(tmpDir, 'antfly.tar.gz')
    op.stage('download')
    try {
      await downloadToFile(url, archivePath, {
        sha256: expectedChecksum,
        timeoutMs: 120_000,
        label: 'Antfly',
        signal: op.signal,
        onEvent: opTransfer(op, 'download'),
        // Resolved per call: the global fetch is the seam the installer tests stub.
        fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)) as typeof fetch,
      })
    } catch (err) {
      op.throwIfCancelled()
      if (err instanceof DownloadChecksumError) {
        op.stage('checksum')
        return {
          name: 'antfly',
          status: 'failed' as const,
          message: `Checksum mismatch for ${url}: expected ${err.expected}, got ${err.actual}. Refusing to install. The release may have been re-published or tampered with - verify upstream before retrying.`,
          durationMs: Date.now() - start,
        }
      }
      return {
        name: 'antfly',
        status: 'failed' as const,
        message: `${err instanceof Error ? err.message : String(err)}. Check connectivity, or whether the pinned release still exists upstream.`,
        durationMs: Date.now() - start,
      }
    }

    // The pin was checked as the bytes streamed in (downloadToFile).
    op.stage('checksum', 'sha256 matches the pin')
    op.stage('extract')
    try {
      await extractTarball(archivePath, tmpDir, { label: 'Antfly archive', signal: op.signal, onOutput: (line) => op.output(line) })
    } catch (err) {
      op.throwIfCancelled()
      return {
        name: 'antfly',
        status: 'failed' as const,
        message: `Failed to extract Antfly archive: ${err instanceof Error ? err.message : String(err)}`,
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
    op.stage('version')
    chmodSync(extractedBinary, 0o755)
    const installedVersion = await antflyBinaryVersion(extractedBinary, { signal: op.signal })
    // A cancel accepted during the probe wins over whatever it reported.
    op.throwIfCancelled()
    if (installedVersion !== pin.version) {
      return {
        name: 'antfly',
        status: 'failed' as const,
        message: `Downloaded binary reports v${installedVersion ?? 'unknown'} instead of the pinned v${pin.version}. Nothing was installed.`,
        durationMs: Date.now() - start,
      }
    }

    return await withServiceOperation(settings, io, intent, async () => {
      op.stage('commit')
      // Staging did not hold the lock: another home may have installed meanwhile.
      const previousVersion = existsSync(targetPath) ? await antflyBinaryVersion(targetPath, { signal: op.signal }) : null
      const hadBinary = existsSync(targetPath)
      const shareTarget = join(antflyHome(), 'share')
      const shareAside = `${shareTarget}.previous`
      refuseLeftoverAside(shareAside, shareTarget, targetPath, pin.version)
      // Stop even an unready engine before shared mutations.
      await stopService(settings, io, intent)
      // Commit order, with the successful binary commit as the rollback
      // boundary: (1) share/ swaps ASIDE (rename, never rm-then-rename — a
      // crash between the two renames leaves share.previous beside a missing
      // share/, and the next install refuses until the operator decides);
      // (2) the binary commits atomically. Before (2) succeeds any failure
      // puts the previous installation back and restarts it if there was
      // one; after it, the new pair is the installation and what did not
      // complete (clear, restart) is reported as such.
      const extractedShare = join(tmpDir, 'share')
      let shareMovedAside = false
      let shareSwappedIn = false
      try {
        if (existsSync(extractedShare)) {
          mkdirSync(dirname(shareTarget), { recursive: true })
          if (existsSync(shareTarget)) {
            fsOps.renameDirectory(shareTarget, shareAside)
            shareMovedAside = true
          }
          fsOps.renameDirectory(extractedShare, shareTarget)
          shareSwappedIn = true
        }
        mkdirSync(dirname(targetPath), { recursive: true })
        await fsOps.commitFile(extractedBinary, targetPath, { mode: 0o755 })
      } catch (err) {
        // Recovery: the half-committed assets move ASIDE (never rm — they may
        // be the only intact copy if the restore below fails), the previous
        // assets come back, and only a fully restored installation restarts.
        // Every recovery failure is reported beside the original error and
        // leaves its artifacts in place for the operator.
        const failedAside = `${shareTarget}.failed`
        const recovery: string[] = []
        if (shareSwappedIn) {
          try {
            if (existsSync(failedAside)) rmSync(failedAside, { recursive: true, force: true })
            fsOps.renameDirectory(shareTarget, failedAside)
          } catch (moveErr) {
            recovery.push(`could not move the half-committed ${shareTarget} aside to ${failedAside}: ${errorText(moveErr)}`)
          }
        }
        if (shareMovedAside && recovery.length === 0) {
          try {
            fsOps.renameDirectory(shareAside, shareTarget)
          } catch (restoreErr) {
            recovery.push(`could not restore ${shareAside} over ${shareTarget}: ${errorText(restoreErr)}`)
          }
        }
        if (recovery.length > 0) {
          op.output(`recovery failed: ${recovery.join('; ')}`)
          throw new Error(
            `${errorText(err)} — and recovery failed: ${recovery.join('; ')}. The engine is stopped; the previous assets are at ${shareAside}${shareSwappedIn ? ` and the half-committed ones at ${failedAside}` : ''}. Restore ${shareTarget} by hand, then run \`bakin install search\`.`,
          )
        }
        if (shareSwappedIn) {
          try { rmSync(failedAside, { recursive: true, force: true }) } catch (cleanupErr) { logger.warn('Could not remove the aside half-committed assets after a successful restore', { dir: failedAside, error: String(cleanupErr) }) }
        }
        if (hadBinary) {
          try {
            await finish()
          } catch (restartErr) {
            throw new Error(`${errorText(err)} — the previous installation was restored but did not restart: ${errorText(restartErr)}. Run \`bakin install search\` to start it.`)
          }
        }
        throw err
      }

      // Engine version change = a deliberate REBUILD event (2026-07-21: the
      // rc.18→rc.21 in-place upgrade silently migrated table files one-way,
      // stalled the data plane for the duration, and made rollback
      // impossible). Search data is derived — clear it and let the repair
      // reindex regenerate the tables instead of trusting an in-place
      // engine-side format migration ever again.
      let dataCleared = false
      if (hadBinary && previousVersion !== pin.version) {
        const dataDir = servicePaths().dataDir
        if (existsSync(dataDir)) {
          op.stage('cleanup')
          logger.info('Engine version changed — clearing derived engine data for a clean rebuild', {
            from: previousVersion ?? 'unknown',
            to: pin.version,
            dataDir,
          })
          try {
            rmSync(dataDir, { recursive: true, force: true })
          } catch (err) {
            throw new Error(`Installed Antfly v${installedVersion} to ${targetPath} (checksum verified), but clearing the derived engine data at ${dataDir} failed: ${errorText(err)}. The new engine and its assets are in place and the engine is STOPPED (it must not start against the old data). Recover in order: remove ${dataDir}; delete ${shareAside} (the new install is complete); run \`bakin install search\` to start the engine; then \`bakin reindex\`.`)
          }
          dataCleared = true
        }
      }
      if (!dataCleared) op.skip('cleanup', 'no engine data to clear')

      try {
        await finish()
      } catch (err) {
        throw new Error(`Installed Antfly v${installedVersion} to ${targetPath} (checksum verified), but the service did not restart: ${errorText(err)}. The new engine and its assets are in place; ${shareAside} is kept until a restart succeeds — run \`bakin install search\` once the cause is fixed.`)
      }
      // Only a running new engine retires the previous assets.
      if (shareMovedAside) {
        try { rmSync(shareAside, { recursive: true, force: true }) } catch (err) { logger.warn('Could not remove share.previous after a successful install', { error: String(err) }) }
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
    })
  } catch (err) {
    op.throwIfCancelled()
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
