import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { AdapterLogger } from '@bakin/core/adapters/shared'

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

export function findAntflyBinary(): string | null {
  const candidates = [
    process.env.ANTFLY_PATH,
    '/opt/homebrew/bin/antfly',
    '/usr/local/bin/antfly',
    join(homedir(), '.antfly', 'bin', 'antfly'),
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
    logger.info('Antfly already running', { url })
    isRunning = true
    scheduleExternalRecheck(settings, logger)
    return true
  }

  const binary = findAntflyBinary()
  if (!binary) {
    logger.warn('Antfly binary not found - install with: brew install --cask antflydb/antfly/antfly')
    return false
  }

  const dataDir = join(homedir(), '.antfly', 'data')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

  logger.info('Starting Antfly server...', { binary, url })

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
      if (line) logger.info(`[antfly] ${line}`)
    })

    antflyProcess.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) logger.warn(`[antfly] ${line}`)
    })

    antflyProcess.on('exit', (code, signal) => {
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

    logger.error('Antfly started but failed health check within timeout')
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
    const base = url.replace(/\/api\/v1\/?$/, '')
    const res = await fetch(`${base}/api/v1/status`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

async function waitForReady(url: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isAlreadyRunning(url)) return true
    await new Promise(r => setTimeout(r, 500))
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
  recheckTimer = setTimeout(async () => {
    recheckTimer = null

    if (antflyProcess) return

    const stillRunning = await isAlreadyRunning(settings.url)
    if (stillRunning) return

    logger.warn('Antfly disappeared after startup check, attempting takeover restart', { url: settings.url })
    await startAntflyServer(settings, logger)
  }, 3000)
}
