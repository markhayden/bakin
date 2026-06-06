import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import type { AdapterLogger } from '@bakin/core/adapters/shared'
import { getBakinPaths } from '@bakin/core/content-dir'
import { DEFAULT_SETTINGS } from './defaults'
import { antflyBinaryPath, inferenceModelsRoot } from './paths'
import { createAntflyLogBuffer } from './server-logs'

export interface AntflyServerSettings {
  enabled: boolean
  url: string
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
  return url === DEFAULT_SETTINGS.url
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
  if (!settings.enabled) {
    logger.info('Antfly disabled - skipping server start')
    return false
  }

  const url = settings.url

  if (await isAlreadyRunning(url)) {
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

  try {
    antflyProcess = spawn(binary, [
      'swarm',
      '--host', '127.0.0.1',
      '--port', String(port),
      '--health-port', String(healthPort),
      '--data-dir', dataDir,
      '--models-dir', inferenceModelsRoot(),
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: {
        ...process.env,
        // The Metal inference backend is unstable at v0.2.0-rc.2
        // (bakin#456): concurrent reranked queries hit a command-encoder
        // assertion (SIGABRT) and even single embeds can die with
        // MTLCommandBufferError Invalid Resource. Pin the embedded
        // inference to the ONNX/CPU backend — plenty fast for Bakin's
        // model sizes — until upstream stabilizes. Env override wins.
        TERMITE_PREFERRED_BACKEND: process.env.TERMITE_PREFERRED_BACKEND ?? 'onnx',
      },
    })

    const stdoutLogs = createAntflyLogBuffer(logger, 'info')
    const stderrLogs = createAntflyLogBuffer(logger, 'warn')
    antflyProcess.stdout?.on('data', (data: Buffer) => {
      stdoutLogs.push(data)
    })

    antflyProcess.stderr?.on('data', (data: Buffer) => {
      stderrLogs.push(data)
    })

    antflyProcess.on('exit', (code, signal) => {
      stdoutLogs.flush()
      stderrLogs.flush()
      isRunning = false
      antflyProcess = null
      clearRecheckTimer()
      if (code !== null && code !== 0) {
        logger.error('Antfly exited unexpectedly', { code, signal })
      } else {
        logger.info('Antfly stopped', { code, signal })
      }
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
    stopAntflyServer(logger)
    return false
  } catch (err) {
    logger.error('Failed to start Antfly server', err)
    return false
  }
}

export function stopAntflyServer(logger: AdapterLogger = noopLogger): void {
  clearRecheckTimer()

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

async function waitForReady(url: string, timeoutMs = 15000, stableChecks = 1): Promise<boolean> {
  const start = Date.now()
  let consecutiveReadyChecks = 0

  while (Date.now() - start < timeoutMs) {
    if (await isAlreadyRunning(url)) {
      consecutiveReadyChecks += 1
      if (consecutiveReadyChecks >= stableChecks) return true
    } else {
      consecutiveReadyChecks = 0
    }

    await sleep(500)
  }

  return false
}

function clearRecheckTimer(): void {
  if (recheckTimer) {
    clearTimeout(recheckTimer)
    recheckTimer = null
  }
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
