import { getSettings } from './settings'

type StartupStatus = 'ok' | 'error' | 'skipped'

export interface StartupDiagnosticLogger {
  debug: (message: string, data?: Record<string, unknown>) => void
  warn: (message: string, errorOrData?: unknown, data?: Record<string, unknown>) => void
}

export interface StartupSpanContext {
  phase: 'plugins' | 'plugin' | 'manifest' | 'browser-plugin-host' | 'search' | 'server' | 'user-plugin-build'
  pluginId?: string
  pluginSource?: 'core' | 'user'
  count?: number
  enabled?: boolean
  debug?: boolean
  thresholdMs?: number
  now?: () => number
}

export interface StartupSpanEndData {
  status?: StartupStatus
  count?: number
  error?: string
  [key: string]: unknown
}

export interface StartupSpanResult {
  phase: StartupSpanContext['phase']
  span: string
  durationMs: number
  status: StartupStatus
}

const DEFAULT_SLOW_SPAN_MS = 250
const MAX_ERROR_LENGTH = 500

function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function parseBooleanEnv(value: string | undefined): boolean | null {
  if (value === undefined) return null
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return null
}

function startupDiagnosticsSettings(): { enabled: boolean; slowMs: number } {
  try {
    const startup = getSettings().diagnostics?.startup
    return {
      enabled: startup?.enabled === true,
      slowMs: typeof startup?.slowMs === 'number' && Number.isFinite(startup.slowMs) && startup.slowMs >= 0
        ? startup.slowMs
        : DEFAULT_SLOW_SPAN_MS,
    }
  } catch {
    return { enabled: false, slowMs: DEFAULT_SLOW_SPAN_MS }
  }
}

function startupDiagnosticsEnabled(input?: boolean): boolean {
  if (typeof input === 'boolean') return input
  const explicit = parseBooleanEnv(process.env.BAKIN_STARTUP_DIAGNOSTICS)
  if (explicit !== null) return explicit
  if (process.env.BAKIN_CONSOLE_FORMAT === 'verbose' || process.env.BAKIN_LOG_LEVEL === 'debug') return true
  return startupDiagnosticsSettings().enabled
}

function slowThresholdMs(input?: number): number {
  const env = Number(process.env.BAKIN_STARTUP_SLOW_MS)
  if (Number.isFinite(env) && env >= 0) return env
  const settings = startupDiagnosticsSettings()
  if (settings.enabled && Number.isFinite(settings.slowMs) && settings.slowMs >= 0) return settings.slowMs
  if (typeof input === 'number' && Number.isFinite(input) && input >= 0) return input
  return DEFAULT_SLOW_SPAN_MS
}

function roundedMs(value: number): number {
  return Math.round(value * 100) / 100
}

function sanitizeError(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const withoutFileUrls = value.replace(/file:\/\/\/[^\s'",)]+/g, '[path]')
  const withoutUnixPaths = withoutFileUrls.replace(
    /(^|[\s("'`])\/(?:Users|home|private|tmp|var|Volumes|opt)\/[^\s'",)]+/g,
    (_match, prefix: string) => `${prefix}[path]`,
  )
  const withoutWindowsPaths = withoutUnixPaths.replace(/[A-Za-z]:\\[^\s'",)]+/g, '[path]')
  if (withoutWindowsPaths.length <= MAX_ERROR_LENGTH) return withoutWindowsPaths
  return `${withoutWindowsPaths.slice(0, MAX_ERROR_LENGTH)}...`
}

export function startStartupSpan(
  log: StartupDiagnosticLogger,
  span: string,
  context: StartupSpanContext,
): { end: (data?: StartupSpanEndData) => StartupSpanResult } {
  const now = context.now ?? monotonicNow
  const startedAt = now()
  const enabled = startupDiagnosticsEnabled(context.enabled)
  const threshold = slowThresholdMs(context.thresholdMs)
  let ended: StartupSpanResult | null = null

  return {
    end(data: StartupSpanEndData = {}): StartupSpanResult {
      if (ended) return ended
      const durationMs = roundedMs(Math.max(0, now() - startedAt))
      const status = data.status ?? 'ok'
      ended = {
        phase: context.phase,
        span,
        durationMs,
        status,
      }
      if (!enabled) return ended

      const payload: Record<string, unknown> = {
        category: 'startup',
        phase: context.phase,
        span,
        durationMs,
        status,
      }
      if (context.pluginId) payload.pluginId = context.pluginId
      if (context.pluginSource) payload.pluginSource = context.pluginSource
      if (context.count !== undefined) payload.count = context.count

      for (const [key, value] of Object.entries(data)) {
        if (value === undefined || key === 'status') continue
        payload[key] = key === 'error' ? sanitizeError(value) : value
      }

      if (context.debug !== false) {
        log.debug('startup span', payload)
      }
      if (status !== 'skipped' && durationMs >= threshold) {
        log.warn('slow startup span', payload)
      }

      return ended
    },
  }
}
