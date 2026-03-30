/**
 * Structured logger for Bakin.
 * Replaces all silent catch{} blocks with contextual JSON logging.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  ts: string
  level: LogLevel
  module: string
  message: string
  error?: string
  data?: Record<string, unknown>
}

function formatEntry(entry: LogEntry): string {
  const parts = [`[${entry.ts}] [${entry.level.toUpperCase()}] [${entry.module}] ${entry.message}`]
  if (entry.error) parts.push(`  error: ${entry.error}`)
  if (entry.data) parts.push(`  data: ${JSON.stringify(entry.data)}`)
  return parts.join('\n')
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
      entry.data = data
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
