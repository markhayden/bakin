/**
 * Structured logger for Bakin.
 * Replaces all silent catch{} blocks with contextual JSON logging.
 *
 * Every log line is also teed to ~/.bakin/logs/server.log so that
 * backgrounded server starts (nohup, launchd, etc.) with stdio
 * redirected to /dev/null still leave a debuggable trail on disk.
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, type WriteStream } from 'fs'
import { join } from 'path'
import { getBakinPaths } from './content-dir'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  ts: string
  level: LogLevel
  module: string
  message: string
  error?: string
  data?: Record<string, unknown>
}

const MAX_LOG_BYTES = 10 * 1024 * 1024 // 10 MB

let fileStream: WriteStream | null = null
let fileTransportInitialized = false
let fileTransportDisabled = false

function fileTransportEnabled(): boolean {
  if (fileTransportDisabled) return false
  // Skip in test runs to avoid touching ~/.bakin/ from suites that forget
  // to mock the logger. The mandatory test-isolation rule still applies,
  // but this is a belt-and-suspenders guard.
  if (process.env.NODE_ENV === 'test') return false
  if (process.env.VITEST) return false
  if (process.env.BAKIN_DISABLE_FILE_LOG === '1') return false
  return true
}

function ensureFileStream(): WriteStream | null {
  if (fileTransportInitialized) return fileStream
  fileTransportInitialized = true
  if (!fileTransportEnabled()) return null

  try {
    const logsDir = getBakinPaths().logs
    if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true })

    const logPath = join(logsDir, 'server.log')

    // Size-based rotation: if the existing log is over MAX_LOG_BYTES,
    // rotate to server.log.1 (single backup, no ring) before opening.
    if (existsSync(logPath)) {
      try {
        const size = statSync(logPath).size
        if (size > MAX_LOG_BYTES) {
          const rotated = join(logsDir, 'server.log.1')
          renameSync(logPath, rotated)
        }
      } catch { /* best-effort rotation */ }
    }

    fileStream = createWriteStream(logPath, { flags: 'a' })
    fileStream.on('error', () => {
      // A failed write must not trigger another log call — drop the stream
      // and disable file transport for the rest of the process lifetime.
      fileTransportDisabled = true
      fileStream = null
    })
  } catch {
    fileTransportDisabled = true
    fileStream = null
  }
  return fileStream
}

function formatEntry(entry: LogEntry): string {
  const parts = [`[${entry.ts}] [${entry.level.toUpperCase()}] [${entry.module}] ${entry.message}`]
  if (entry.error) parts.push(`  error: ${entry.error}`)
  if (entry.data) parts.push(`  data: ${JSON.stringify(entry.data)}`)
  return parts.join('\n')
}

function writeToFile(entry: LogEntry): void {
  const stream = ensureFileStream()
  if (!stream) return
  try {
    stream.write(JSON.stringify(entry) + '\n')
  } catch {
    // Same recovery rule as the stream error handler — never recurse.
    fileTransportDisabled = true
    fileStream = null
  }
}

function createLogger(module: string) {
  function log(level: LogLevel, message: string, errorOrData?: unknown, data?: Record<string, unknown>) {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      module,
      message,
    }

    if (errorOrData instanceof Error) {
      entry.error = errorOrData.message
      entry.data = data ? { ...data, stack: errorOrData.stack } : { stack: errorOrData.stack }
    } else if (typeof errorOrData === 'string') {
      entry.error = errorOrData
      entry.data = data
    } else if (errorOrData && typeof errorOrData === 'object') {
      entry.data = errorOrData as Record<string, unknown>
    }

    const formatted = formatEntry(entry)
    if (level === 'error') {
      console.error(formatted)
    } else if (level === 'warn') {
      console.warn(formatted)
    } else {
      console.log(formatted)
    }

    writeToFile(entry)
  }

  return {
    debug: (message: string, data?: Record<string, unknown>) => log('debug', message, data),
    info: (message: string, data?: Record<string, unknown>) => log('info', message, data),
    warn: (message: string, errorOrData?: unknown, data?: Record<string, unknown>) => log('warn', message, errorOrData, data),
    error: (message: string, errorOrData?: unknown, data?: Record<string, unknown>) => log('error', message, errorOrData, data),
  }
}

export type Logger = ReturnType<typeof createLogger>
export { createLogger }
