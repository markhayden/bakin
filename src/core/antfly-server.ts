/**
 * Antfly server process management.
 * Starts/stops the AntflyDB server as a child process when antfly.enabled is true.
 * Bakin owns the lifecycle — starts on boot, stops on shutdown.
 */
import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { createLogger } from './logger'
import { getSettings } from './settings'

const log = createLogger('antfly-server')

let antflyProcess: ChildProcess | null = null
let isRunning = false

/**
 * Find the antfly binary on the system. Exported for reuse by the
 * first-run onboarding antfly component — its `check()` needs the
 * exact same binary discovery logic that the server boot path uses,
 * and duplicating the candidate list would invite drift.
 */
export function findBinary(): string | null {
  const candidates = [
    process.env.ANTFLY_PATH,
    '/opt/homebrew/bin/antfly',
    '/usr/local/bin/antfly',
    join(process.env.HOME || '~', '.antfly', 'bin', 'antfly'),
  ]

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }

  return null
}

/**
 * Check if Antfly is already running by hitting the health endpoint.
 */
async function isAlreadyRunning(url: string): Promise<boolean> {
  try {
    // URL may include /api/v1 suffix for SDK — normalize to base for health check
    const base = url.replace(/\/api\/v1\/?$/, '')
    const res = await fetch(`${base}/api/v1/status`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Wait for Antfly to become healthy after starting.
 */
async function waitForReady(url: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isAlreadyRunning(url)) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

/**
 * Start the Antfly server if enabled and not already running.
 * Returns true if Antfly is available (either started or already running).
 */
export async function start(): Promise<boolean> {
  const settings = getSettings()

  if (!settings.antfly.enabled) {
    log.info('Antfly disabled — skipping server start')
    return false
  }

  const url = settings.antfly.url

  // Check if already running (maybe started externally)
  if (await isAlreadyRunning(url)) {
    log.info('Antfly already running', { url })
    isRunning = true
    return true
  }

  // Find the binary
  const binary = findBinary()
  if (!binary) {
    log.warn('Antfly binary not found — install with: brew install --cask antflydb/antfly/antfly')
    return false
  }

  // Ensure data directory exists
  const dataDir = join(process.env.HOME || '~', '.antfly', 'data')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

  log.info('Starting Antfly server...', { binary, url })

  try {
    const baseUrl = url.replace(/\/api\/v1\/?$/, '').replace('localhost', '0.0.0.0')
    antflyProcess = spawn(binary, ['swarm', '--metadata-api', baseUrl], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: {
        ...process.env,
        ANTFLY_DATA_DIR: dataDir,
      },
    })

    antflyProcess.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) log.info(`[antfly] ${line}`)
    })

    antflyProcess.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) log.warn(`[antfly] ${line}`)
    })

    antflyProcess.on('exit', (code, signal) => {
      isRunning = false
      antflyProcess = null
      if (code !== null && code !== 0) {
        log.error('Antfly exited unexpectedly', { code, signal })
      } else {
        log.info('Antfly stopped', { code, signal })
      }
    })

    antflyProcess.on('error', (err) => {
      isRunning = false
      log.error('Failed to start Antfly', err)
    })

    // Wait for it to become healthy
    const ready = await waitForReady(url)
    if (ready) {
      isRunning = true
      log.info('Antfly server started and healthy', { url })
      return true
    } else {
      log.error('Antfly started but failed health check within timeout')
      stop()
      return false
    }
  } catch (err) {
    log.error('Failed to start Antfly server', err)
    return false
  }
}

/**
 * Stop the Antfly server if we started it.
 */
export function stop(): void {
  if (!antflyProcess) return

  log.info('Stopping Antfly server...')

  try {
    antflyProcess.kill('SIGTERM')

    // Force kill after 5 seconds if it doesn't stop
    const forceTimer = setTimeout(() => {
      if (antflyProcess) {
        log.warn('Force killing Antfly server')
        antflyProcess.kill('SIGKILL')
      }
    }, 5000)

    antflyProcess.on('exit', () => {
      clearTimeout(forceTimer)
    })
  } catch (err) {
    log.warn('Error stopping Antfly', err)
  }

  antflyProcess = null
  isRunning = false
}

/**
 * Check if Antfly is currently running (either managed or external).
 */
export function running(): boolean {
  return isRunning
}

/**
 * Check if the antfly binary is installed on the system.
 */
export function installed(): boolean {
  return findBinary() !== null
}
