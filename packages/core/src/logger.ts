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
type ConsoleFormat = 'plain' | 'pretty' | 'verbose' | 'silent'

interface LogEntry {
  ts: string
  level: LogLevel
  module: string
  message: string
  error?: string
  data?: Record<string, unknown>
}

const MAX_LOG_BYTES = 10 * 1024 * 1024 // 10 MB
const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const COLOR_RESET = '\x1b[0m'
const COLORS = {
  dim: '\x1b[2m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
} as const

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

function consoleFormat(): ConsoleFormat {
  const configured = process.env.BAKIN_CONSOLE_FORMAT
  if (configured === 'pretty' || configured === 'verbose' || configured === 'plain' || configured === 'silent') {
    return configured
  }
  return process.stdout.isTTY === true ? 'pretty' : 'plain'
}

function consoleMinLevel(format: ConsoleFormat): LogLevel {
  const configured = process.env.BAKIN_LOG_LEVEL
  if (configured === 'debug' || configured === 'info' || configured === 'warn' || configured === 'error') {
    return configured
  }
  if (format === 'verbose') return 'debug'
  if (format === 'silent') return 'error'
  if (format === 'pretty') return 'info'
  return 'debug'
}

function colorEnabled(format: ConsoleFormat): boolean {
  if (format === 'plain') return false
  if (process.env.NO_COLOR || process.env.BAKIN_NO_COLOR === '1') return false
  return process.stdout.isTTY === true
}

function colorize(text: string, color: keyof typeof COLORS, enabled: boolean): string {
  return enabled ? `${COLORS[color]}${text}${COLOR_RESET}` : text
}

function sourceLabel(entry: LogEntry): string {
  const data = entry.data
  const explicitSource = typeof data?.source === 'string' ? data.source : undefined
  const pluginId = typeof data?.pluginId === 'string' ? data.pluginId : undefined

  if (explicitSource === 'antfly') return 'antfly'
  if (explicitSource === 'dev') return 'dev'
  if (explicitSource === 'plugin' && pluginId) return `plugin:${pluginId}`
  if (entry.module === 'plugin-registry' && pluginId) return `plugin:${pluginId}`
  if (entry.module.startsWith('api:')) return 'api'
  return entry.module
}

function sourceColor(source: string): keyof typeof COLORS {
  if (source === 'dev') return 'cyan'
  if (source === 'server') return 'blue'
  if (source === 'antfly') return 'magenta'
  if (source.startsWith('plugin:')) return 'green'
  if (source.includes('search')) return 'cyan'
  if (source.includes('runtime')) return 'magenta'
  return 'dim'
}

function levelColor(level: LogLevel): keyof typeof COLORS {
  if (level === 'debug') return 'dim'
  if (level === 'warn') return 'yellow'
  if (level === 'error') return 'red'
  return 'blue'
}

function isImportantAntflyInfo(entry: LogEntry): boolean {
  return [
    'Metadata API server is ready',
    'Store HTTP server is ready',
    'Swarm mode: all servers are ready',
    'Termite\'s api server starting',
  ].some((message) => entry.message.includes(message))
}

function suppressPrettyInfo(entry: LogEntry): boolean {
  if (entry.level !== 'info') return false
  if (entry.data?.source === 'antfly') return !isImportantAntflyInfo(entry)
  if (entry.module === 'plugin-registry') {
    return entry.message === 'plugin activated'
      || entry.message.startsWith('Auto-registered ')
      || entry.message.startsWith('Plugin activation order:')
  }
  return [
    'search-registry',
    'search-reconcile',
    'search-cleanup',
    'hot-reload-coordinator',
    'mcporter',
    'dispatch',
    'watchdog',
    'doctor',
    'lifecycle',
  ].includes(entry.module)
}

function shouldWriteConsole(entry: LogEntry, format: ConsoleFormat): boolean {
  if (format === 'silent') return false
  const minLevel = consoleMinLevel(format)
  if (LEVEL_RANK[entry.level] < LEVEL_RANK[minLevel]) return false
  if (format === 'pretty' && suppressPrettyInfo(entry)) return false
  return true
}

function formatPrettyEntry(entry: LogEntry, format: Exclude<ConsoleFormat, 'plain'>): string {
  const colors = colorEnabled(format)
  const time = new Date(entry.ts).toTimeString().slice(0, 8)
  const level = entry.level.padEnd(5)
  const source = sourceLabel(entry)
  const label = source.padEnd(18)
  const levelPart = colorize(level, levelColor(entry.level), colors)
  const sourcePart = colorize(label, sourceColor(source), colors)
  const messagePart = entry.level === 'error'
    ? colorize(entry.message, 'red', colors)
    : entry.message

  const parts = [`${colorize(time, 'dim', colors)}  ${levelPart}  ${sourcePart}  ${messagePart}`]
  if (entry.error) parts[0] += ` - ${entry.error}`
  if (format === 'verbose' && entry.data) {
    parts.push(`  data: ${JSON.stringify(entry.data)}`)
  }
  return parts.join('\n')
}

function formatConsoleEntry(entry: LogEntry): string {
  const format = consoleFormat()
  if (format === 'plain') return formatEntry(entry)
  if (format === 'silent') return ''
  return formatPrettyEntry(entry, format)
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

    const format = consoleFormat()
    if (shouldWriteConsole(entry, format)) {
      const formatted = formatConsoleEntry(entry)
      if (level === 'error') {
        console.error(formatted)
      } else if (level === 'warn') {
        console.warn(formatted)
      } else {
        console.log(formatted)
      }
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
