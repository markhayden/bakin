import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { AdapterLogger } from '@bakin/core/adapters/shared'

export interface AntflyServerSettings {
  enabled: boolean
  url: string
}

type AntflyLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ParsedAntflyLogLine {
  level: AntflyLogLevel
  message: string
  data: Record<string, unknown>
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function readExternalRecheckDelayMs(): number {
  const raw = process.env.BAKIN_ANTFLY_EXTERNAL_RECHECK_MS
  if (raw === undefined) return DEFAULT_EXTERNAL_RECHECK_DELAY_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_EXTERNAL_RECHECK_DELAY_MS
}

function unquoteAntflyValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"')
  }
  return value
}

function parseAntflyFields(line: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const pattern = /([A-Za-z0-9_.-]+)=("(?:\\.|[^"])*"|[^\s]+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(line)) !== null) {
    fields[match[1]] = unquoteAntflyValue(match[2])
  }
  return fields
}

const SHARD_INITIALIZING_ERROR = 'shard is still initializing'
const TRANSIENT_RECONCILER_MESSAGES = new Set([
  'Failed to add index',
  'Failed to update schema',
])
const OPTIONAL_TERMITE_MODEL_DIRECTORY_MESSAGES = new Set([
  'Chunker models directory does not exist',
  'Generator models directory does not exist',
  'NER models directory does not exist',
  'Seq2Seq models directory does not exist',
  'Classifier models directory does not exist',
  'Reader models directory does not exist',
  'Transcriber models directory does not exist',
])
const ANTFLY_WARNING_DETAIL_KEYS = [
  'tableName',
  'table',
  'indexName',
  'name',
  'shardID',
  'error',
] as const

function compactAntflyValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function summarizeAntflyFields(fields: Record<string, string>, keys: readonly string[]): string {
  const parts: string[] = []
  for (const key of keys) {
    const value = fields[key]
    if (!value) continue
    parts.push(`${key}=${compactAntflyValue(value)}`)
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

function isTransientReconcilerWarning(message: string, fields: Record<string, string>): boolean {
  return TRANSIENT_RECONCILER_MESSAGES.has(message) && fields.error === SHARD_INITIALIZING_ERROR
}

function isOptionalTermiteModelDirectoryWarning(message: string, fields: Record<string, string>): boolean {
  return OPTIONAL_TERMITE_MODEL_DIRECTORY_MESSAGES.has(message)
    && fields.caller?.startsWith('termite/') === true
    && typeof fields.dir === 'string'
}

function isExpectedStartupDebug(message: string, fields: Record<string, string>): boolean {
  return isTransientReconcilerWarning(message, fields)
    || isOptionalTermiteModelDirectoryWarning(message, fields)
}

function transientReconcilerMessage(message: string, fields: Record<string, string>): string {
  if (message === 'Failed to add index') {
    return `Antfly reconciler deferred index update until shard initialization completes${
      summarizeAntflyFields(fields, ['indexName', 'shardID'])
    }`
  }
  return `Antfly reconciler deferred schema update until shard initialization completes${
    summarizeAntflyFields(fields, ['shardID'])
  }`
}

function optionalTermiteModelDirectoryMessage(message: string, fields: Record<string, string>): string {
  const registry = message.replace(' models directory does not exist', '').toLowerCase()
  return `Antfly skipped optional Termite ${registry} registry with no local models${
    summarizeAntflyFields(fields, ['dir'])
  }`
}

function formatAntflyLogMessage(
  message: string,
  level: AntflyLogLevel,
  fields: Record<string, string>,
): string {
  if (isTransientReconcilerWarning(message, fields)) {
    return transientReconcilerMessage(message, fields)
  }
  if (isOptionalTermiteModelDirectoryWarning(message, fields)) {
    return optionalTermiteModelDirectoryMessage(message, fields)
  }
  if (level !== 'warn' && level !== 'error') return message
  return `${message}${summarizeAntflyFields(fields, ANTFLY_WARNING_DETAIL_KEYS)}`
}

export function parseAntflyLogLine(line: string, streamLevel: AntflyLogLevel): ParsedAntflyLogLine {
  const fields = parseAntflyFields(line)
  const parsedLevel = fields.lvl
  const rawLevel: AntflyLogLevel = parsedLevel === 'debug'
    || parsedLevel === 'info'
    || parsedLevel === 'warn'
    || parsedLevel === 'error'
    ? parsedLevel
    : streamLevel
  const rawMessage = fields.msg || line
  const level = isExpectedStartupDebug(rawMessage, fields) ? 'debug' : rawLevel

  const data: Record<string, unknown> = { source: 'antfly', raw: line }
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'ts' || key === 'lvl' || key === 'msg') continue
    data[key] = value
  }

  return {
    level,
    message: formatAntflyLogMessage(rawMessage, rawLevel, fields),
    data,
  }
}

function writeParsedAntflyLog(logger: AdapterLogger, parsed: ParsedAntflyLogLine): void {
  if (parsed.level === 'debug') logger.debug(parsed.message, parsed.data)
  else if (parsed.level === 'info') logger.info(parsed.message, parsed.data)
  else if (parsed.level === 'warn') logger.warn(parsed.message, parsed.data)
  else logger.error(parsed.message, parsed.data)
}

function createAntflyLogBuffer(logger: AdapterLogger, streamLevel: AntflyLogLevel) {
  let pending = ''
  const flushLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    writeParsedAntflyLog(logger, parseAntflyLogLine(trimmed, streamLevel))
  }
  return {
    push(data: Buffer) {
      pending += data.toString()
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) flushLine(line)
    },
    flush() {
      flushLine(pending)
      pending = ''
    },
  }
}

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
      logger.warn('Antfly status endpoint is responding but not stable yet', { url })
      return false
    }

    logger.warn('Antfly disappeared during startup check, attempting takeover restart', { url })
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

    logger.warn('Antfly disappeared after startup check, attempting takeover restart', { url: settings.url })
    await startAntflyServer(settings, logger)
  }, delayMs)
}
