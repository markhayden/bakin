import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import type { AdapterLogger } from '@bakin/core/adapters/shared'
import { getBakinPaths } from '@bakin/core/content-dir'
import { DEFAULT_SETTINGS, type AntflySettings } from './defaults'
import { antflyBinaryPath, inferenceModelsRoot } from './paths'
import { createAntflyLogBuffer } from './server-logs'

export interface AntflyServerSettings {
  enabled: boolean
  url: string
  // Optional: production passes the full settings, so the spawn can preload the
  // declared local embedders. Minimal callers (tests) omit it and fall back to
  // DEFAULT_SETTINGS.embedders.
  embedders?: AntflySettings['embedders']
}

const noopLogger: AdapterLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

let antflyProcess: ChildProcess | null = null
let isRunning = false
let recheckTimer: NodeJS.Timeout | null = null
let exitHookRegistered = false

// Supervision for Bakin's own spawned child: a mid-session crash must flip
// isRunning false (so available() stops lying) AND get a bounded restart —
// previously only the adopted-external path was ever rechecked, so a crashed
// own-child stayed dead (queries fail-empty, writes dropped) until a manual
// server restart.
let childStopRequested = false
let childRestartAttempts = 0
let childRestartTimer: NodeJS.Timeout | null = null
// Single-flight guard: a scheduled restart must JOIN an in-flight start, not
// spawn a second child alongside it — two concurrent invocations previously
// let a stale one's failure path kill the fresh child and disable supervision.
let startInFlight: Promise<boolean> | null = null
const CHILD_RESTART_DELAYS_MS: readonly number[] = [1000, 5000, 30_000]
// A child that ITSELF survived this long before dying gets a fresh restart
// budget — only rapid crash-loops exhaust the attempts. Measured from the
// dying child's own spawn time, never from the last healthy start: a child
// that crashes before ever becoming ready must burn budget, not reset it.
const CHILD_STABLE_MS = 60_000

/**
 * Belt-and-braces orphan net: any JS-level exit that bypasses the async
 * lifecycle shutdown — dev.ts's own signal handlers calling process.exit(0),
 * an uncaught EADDRINUSE thrown at listen time, a plain process.exit anywhere —
 * must still take the spawned antfly child down. Orphaned children keep 3738
 * bound and poison the next server generation. 'exit' handlers must be
 * synchronous; ChildProcess.kill() is.
 */
function killChildOnExit(): void {
  if (antflyProcess && !antflyProcess.killed) antflyProcess.kill('SIGTERM')
}

function registerExitHook(): void {
  if (exitHookRegistered) return
  exitHookRegistered = true
  process.on('exit', killChildOnExit)
}

/** Tests use this between cases — the exit hook is once-per-process. */
export function _resetExitHookForTests(): void {
  process.removeListener('exit', killChildOnExit)
  exitHookRegistered = false
}

/** Tests use this between cases — supervision state is module-global. */
export function _resetChildSupervisionForTests(): void {
  childStopRequested = false
  childRestartAttempts = 0
  startInFlight = null
  if (childRestartTimer) {
    clearTimeout(childRestartTimer)
    childRestartTimer = null
  }
}

const DEFAULT_EXTERNAL_RECHECK_DELAY_MS = 3000
const DEFAULT_PORT = 3738

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function readExternalRecheckDelayMs(): number {
  const raw = process.env.BAKIN_ANTFLY_EXTERNAL_RECHECK_MS
  if (raw === undefined) return DEFAULT_EXTERNAL_RECHECK_DELAY_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_EXTERNAL_RECHECK_DELAY_MS
}

export function findAntflyBinary(): string | null {
  const candidates = [
    process.env.ANTFLY_PATH,
    antflyBinaryPath(),
  ]

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }

  return null
}

export function isAntflyInstalled(): boolean {
  return findAntflyBinary() !== null
}

export function isAntflyRunning(): boolean {
  return isRunning
}

/**
 * Whether settings point at Bakin's own private instance (which Bakin spawns
 * and supervises) vs an externally managed server (guest mode: connect only —
 * never spawn, never touch its disk).
 */
export function isLocalDefaultUrl(url: string): boolean {
  // localhost spelling counts too: settings.json files written before the
  // dial-what-we-bind fix carry it, and it means the same private instance.
  // (The client itself always dials DEFAULT_SETTINGS.url's 127.0.0.1.)
  return url === DEFAULT_SETTINGS.url || url === 'http://localhost:3738'
}

function serverOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url.replace(/\/+$/, '')
  }
}

function serverPort(url: string): number {
  try {
    const parsed = new URL(url)
    if (parsed.port) return Number(parsed.port)
    return parsed.protocol === 'https:' ? 443 : 80
  } catch {
    return DEFAULT_PORT
  }
}

export type ExternalAntflyStability = 'ready' | 'unstable' | 'disappeared'

export async function checkExternalAntflyStability(
  url: string,
  opts: {
    initialTimeoutMs?: number
    stableChecks?: number
    recheckDelayMs?: number
  } = {},
): Promise<ExternalAntflyStability> {
  const stable = await waitForReady(url, opts.initialTimeoutMs ?? 3000, opts.stableChecks ?? 3)
  if (!stable) return await isAlreadyRunning(url) ? 'unstable' : 'disappeared'

  const recheckDelayMs = opts.recheckDelayMs ?? readExternalRecheckDelayMs()
  if (recheckDelayMs > 0) await sleep(recheckDelayMs)
  return await isAlreadyRunning(url) ? 'ready' : 'disappeared'
}

export interface ServerHealthDetail {
  reachable: boolean
  /**
   * True when the configured endpoint answers the pre-0.2 status path but not
   * /readyz — i.e. an old antfly version is running at that URL.
   */
  legacyServer: boolean
}

export async function getServerHealthDetail(url: string): Promise<ServerHealthDetail> {
  if (await isAlreadyRunning(url)) return { reachable: true, legacyServer: false }
  return { reachable: false, legacyServer: await isLegacyServer(url) }
}

export async function startAntflyServer(
  settings: AntflyServerSettings,
  logger: AdapterLogger = noopLogger,
): Promise<boolean> {
  // Single-flight: concurrent callers (adapter init, restart supervision,
  // takeover recheck) join the in-flight attempt instead of racing spawns.
  if (startInFlight) return startInFlight
  const attempt = startAntflyServerInner(settings, logger).finally(() => {
    startInFlight = null
  })
  startInFlight = attempt
  return attempt
}

async function startAntflyServerInner(
  settings: AntflyServerSettings,
  logger: AdapterLogger = noopLogger,
): Promise<boolean> {
  if (!settings.enabled) {
    logger.info('Antfly disabled - skipping server start')
    return false
  }

  const url = settings.url

  if (await isAlreadyRunning(url)) {
    // Before adopting a pre-existing listener as OUR server, demand a valid
    // antfly status response — a bare readyz 200 is not enough. An orphaned
    // or wedged process squatting on the port (parent died mid-boot, crashed
    // inference, anything else bound there) can answer readyz while serving
    // garbage on /db/v1/*; adopting it hands the client a broken server and
    // our own spawn would silently fail to bind behind it.
    if (!await servesValidAntflyStatus(url)) {
      logger.error(
        `A process answers on ${url} but does not serve the antfly API correctly - likely an orphaned or wedged antfly holding the port. Find it with \`lsof -nP -iTCP:${serverPort(url)} -sTCP:LISTEN\`, kill it, and restart Bakin.`,
        { url },
      )
      return false
    }

    const stability = await checkExternalAntflyStability(url)
    if (stability === 'ready') {
      logger.info('Antfly already running', { url })
      isRunning = true
      scheduleExternalRecheck(settings, logger)
      return true
    }

    if (stability === 'unstable') {
      logger.warn('Antfly readiness endpoint is responding but not stable yet', { url })
      return false
    }

    if (isLocalDefaultUrl(url)) {
      logger.warn('Antfly disappeared during startup check, attempting takeover restart', { url })
    }
  }

  // Guest mode: a non-default URL is an externally managed server. Bakin
  // connects but never spawns a process for it and never touches its disk.
  if (!isLocalDefaultUrl(url)) {
    if (await isLegacyServer(url)) {
      logger.warn(
        'Server at configured antfly URL answers the pre-0.2 status endpoint but not /readyz - it looks like an old antfly version. Upgrade it to v0.2+, or remove the custom url to use Bakin\'s own instance.',
        { url },
      )
    } else {
      logger.warn('External antfly server is not reachable - running in file-only mode', { url })
    }
    return false
  }

  const binary = findAntflyBinary()
  if (!binary) {
    logger.warn('Antfly binary not found - run `bakin install search` to install it')
    return false
  }

  const dataDir = getBakinPaths().antfly
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

  const port = serverPort(url)
  const healthPort = port + 1

  logger.info('Starting Antfly server...', { binary, url, dataDir })

  // Inference backend (bakin#456). The rc.2 onnx pin worked around a Metal
  // instability (concurrent reranked queries SIGABRTed on a command-encoder
  // assertion; single embeds could die with MTLCommandBufferError). v0.2.0-rc.9
  // fixes that: a Metal instance survives a full reindex and concurrent embeds
  // (live-verified), so the pin is dropped — antfly auto-selects Metal on Apple
  // Silicon (faster embeddings) and CPU/onnx on Linux. NOTE: reranking is NOT
  // re-enabled (see defaults.ts) — it's slow on Metal (~3s/query, serializes
  // under concurrency) and the auto-selected backend loads the onnx mxbai
  // variant, which fails (MissingWeight); enabling it needs an explicit
  // TERMITE_PREFERRED_BACKEND=metal, which still wins here when set.
  // Preload + warm the local embedder models before serving. antfly otherwise
  // loads embed models lazily on first use, so the enrichment (embeddings
  // backfill) worker races a cold model load against its non-configurable ~30s
  // embed timeout; a cold miss surfaces as a *retryable* error the worker then
  // loops on forever without advancing its cursor — a poison-pill wedge that
  // freezes backfill and leaves semantic search empty (bakin#456). Each
  // --preload-model makes antfly run a real warm embed pass up front, closing
  // the race. Preload every in-process antfly embedder the settings declare
  // (text 'default' + 'visual'), de-duped.
  const preloadArgs = Array.from(
    new Set(
      Object.values(settings.embedders ?? DEFAULT_SETTINGS.embedders)
        .filter((embedder) => embedder.provider === 'antfly')
        .map((embedder) => embedder.model),
    ),
  ).flatMap((model) => ['--preload-model', `embedder:${model}`])

  try {
    childStopRequested = false
    const spawnedAtMs = Date.now()
    antflyProcess = spawn(binary, [
      'swarm',
      '--host', '127.0.0.1',
      '--port', String(port),
      '--health-port', String(healthPort),
      '--data-dir', dataDir,
      '--models-dir', inferenceModelsRoot(),
      ...preloadArgs,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      // antfly picks the inference backend from ANTFLY_INFERENCE_PREFERRED_BACKEND
      // (legacy TERMITE_PREFERRED_BACKEND as a fallback); both are inherited via
      // process.env. Unset => auto-select (Metal on Apple Silicon, CPU/onnx on Linux).
      env: { ...process.env },
    })
    registerExitHook()

    const stdoutLogs = createAntflyLogBuffer(logger, 'info')
    const stderrLogs = createAntflyLogBuffer(logger, 'warn')
    antflyProcess.stdout?.on('data', (data: Buffer) => {
      stdoutLogs.push(data)
    })

    antflyProcess.stderr?.on('data', (data: Buffer) => {
      stderrLogs.push(data)
    })

    const thisChild = antflyProcess
    antflyProcess.on('exit', (code, signal) => {
      stdoutLogs.flush()
      stderrLogs.flush()
      isRunning = false
      if (antflyProcess === thisChild) antflyProcess = null
      clearRecheckTimer()
      if (childStopRequested) {
        logger.info('Antfly stopped', { code, signal })
        return
      }
      logger.error('Antfly exited unexpectedly', { code, signal })
      // Budget resets only when THIS child proved stable before dying — a
      // child that never became ready must burn budget, or a bad data dir
      // would respawn at 1s cadence forever.
      scheduleChildRestart(settings, logger, Date.now() - spawnedAtMs)
    })

    antflyProcess.on('error', (err) => {
      isRunning = false
      logger.error('Failed to start Antfly', err)
    })

    const ready = await waitForReady(url)
    if (ready) {
      isRunning = true
      logger.info('Antfly server started and healthy', { url })
      return true
    }

    logger.error('Antfly started but failed readiness check within timeout')
    // Kill ONLY the child this attempt spawned, and WITHOUT flipping
    // childStopRequested — this is a failure, not a requested stop, so its
    // exit handler still runs the bounded restart ladder. stopAntflyServer()
    // here would mark the exit as intentional and permanently disable
    // supervision (and under a racing restart it killed the fresh child).
    killChildScoped(thisChild, logger)
    return false
  } catch (err) {
    logger.error('Failed to start Antfly server', err)
    return false
  }
}

/** SIGTERM (then SIGKILL) exactly one child, leaving supervision state alone. */
function killChildScoped(child: ChildProcess, logger: AdapterLogger): void {
  let exited = false
  try {
    child.kill('SIGTERM')
    const forceTimer = setTimeout(() => {
      if (!exited) {
        logger.warn('Force killing unready Antfly child')
        child.kill('SIGKILL')
      }
    }, 5000)
    forceTimer.unref?.()
    child.once('exit', () => {
      exited = true
      clearTimeout(forceTimer)
    })
  } catch (err) {
    logger.warn('Error killing unready Antfly child', err)
  }
}

export function stopAntflyServer(logger: AdapterLogger = noopLogger): void {
  clearRecheckTimer()
  childStopRequested = true
  if (childRestartTimer) {
    clearTimeout(childRestartTimer)
    childRestartTimer = null
  }

  if (!antflyProcess) {
    isRunning = false
    return
  }

  logger.info('Stopping Antfly server...')
  const child = antflyProcess
  let exited = false

  try {
    child.kill('SIGTERM')

    const forceTimer = setTimeout(() => {
      if (!exited) {
        logger.warn('Force killing Antfly server')
        child.kill('SIGKILL')
      }
    }, 5000)

    child.once('exit', () => {
      exited = true
      clearTimeout(forceTimer)
    })
  } catch (err) {
    logger.warn('Error stopping Antfly', err)
  }

  antflyProcess = null
  isRunning = false
}

async function isAlreadyRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${serverOrigin(url)}/readyz`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

async function isLegacyServer(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${serverOrigin(url)}/api/v1/status`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Strict adoption probe: the listener must return parseable JSON with a
 * `health` field from the v0.2 status endpoint. Distinguishes a real antfly
 * from an orphaned/wedged process (or anything else) that merely 200s.
 */
async function servesValidAntflyStatus(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${serverOrigin(url)}/db/v1/status`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return false
    const body = await res.json() as { health?: unknown }
    return typeof body === 'object' && body !== null && 'health' in body
  } catch {
    return false
  }
}

async function waitForReady(url: string, timeoutMs = 15000, stableChecks = 1): Promise<boolean> {
  const pollMs = 500
  // Bounded by BOTH wall clock and poll count: the wall clock caps slow-probe
  // real time; the poll count keeps the loop finite under mocked timers
  // (where Date.now barely advances while sleeps fire instantly).
  const maxPolls = Math.max(1, Math.ceil(timeoutMs / pollMs))
  const start = Date.now()
  let consecutiveReadyChecks = 0

  for (let i = 0; i < maxPolls && Date.now() - start < timeoutMs * 2; i++) {
    if (await isAlreadyRunning(url)) {
      consecutiveReadyChecks += 1
      if (consecutiveReadyChecks >= stableChecks) return true
    } else {
      consecutiveReadyChecks = 0
    }

    await sleep(pollMs)
  }

  return false
}

function clearRecheckTimer(): void {
  if (recheckTimer) {
    clearTimeout(recheckTimer)
    recheckTimer = null
  }
}

function scheduleChildRestart(settings: AntflyServerSettings, logger: AdapterLogger, childLifetimeMs: number): void {
  if (childRestartTimer) return
  if (childLifetimeMs >= CHILD_STABLE_MS) childRestartAttempts = 0
  if (childRestartAttempts >= CHILD_RESTART_DELAYS_MS.length) {
    logger.error(
      'Antfly crash-looped through every restart attempt - search stays unavailable until `bakin restart`. Check ~/.bakin/logs/server.log for the antfly crash output.',
      { attempts: childRestartAttempts },
    )
    return
  }
  const delayMs = CHILD_RESTART_DELAYS_MS[childRestartAttempts]
  childRestartAttempts += 1
  logger.warn('Restarting crashed Antfly child', { attempt: childRestartAttempts, delayMs })
  childRestartTimer = setTimeout(async () => {
    childRestartTimer = null
    if (childStopRequested || antflyProcess) return
    try {
      const ok = await startAntflyServer(settings, logger)
      // A failed attempt burns budget (lifetime 0). If the attempt spawned a
      // child that then died, its exit handler also tries to schedule — the
      // childRestartTimer guard makes that a no-op.
      if (!ok) scheduleChildRestart(settings, logger, 0)
    } catch (err) {
      logger.error('Antfly restart attempt failed', err)
      scheduleChildRestart(settings, logger, 0)
    }
  }, delayMs)
  childRestartTimer.unref?.()
}

function scheduleExternalRecheck(settings: AntflyServerSettings, logger: AdapterLogger): void {
  clearRecheckTimer()
  const delayMs = readExternalRecheckDelayMs()
  if (delayMs <= 0) return
  recheckTimer = setTimeout(async () => {
    recheckTimer = null

    if (antflyProcess) return

    const stillRunning = await isAlreadyRunning(settings.url)
    if (stillRunning) return

    // Whoever we adopted is gone — reflect it immediately so available()
    // reports the truth even if the takeover below can't bring one back.
    isRunning = false

    // Takeover restarts only apply to Bakin's own instance; an external
    // server going away is its owner's business.
    if (!isLocalDefaultUrl(settings.url)) {
      logger.warn('External antfly server disappeared - search degraded to file-only mode', { url: settings.url })
      return
    }

    logger.warn('Antfly disappeared after startup check, attempting takeover restart', { url: settings.url })
    await startAntflyServer(settings, logger)
  }, delayMs)
}
