/**
 * Core settings system for Bakin.
 * Reads from content/settings.json with defaults for all values.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createLogger } from './logger'
import { getContentDir } from './content-dir'

const log = createLogger('settings')

export interface BakinSettings {
  dispatch: {
    intervalMs: number
    failureCooldownMs: number
    maxDispatched: number
    maxRetries: number
  }
  watchdog: {
    intervalMs: number
    stuckThresholdMs: number
    alertChannelId: string
    autoRecover: boolean
    maxAutoRecoveries: number
  }
  calendar: {
    intervalMs: number
  }
  sse: {
    maxClients: number
    keepAliveMs: number
  }
  openclaw: {
    binaryPath: string
    gatewayUrl: string
    gatewayPort: number
  }
  models: {
    allowlist?: string[]
    blocklist?: string[]
  }
  agents: string[]
  antfly: {
    enabled: boolean
    url: string
    auth?: { username: string; password: string }
  }
  doctor: {
    intervalMs: number
    autoFixSkill: boolean
  }
  service: {
    enabled: boolean
  }
  notifications: {
    channel: 'discord' | 'slack' | 'none'
    target: string
    gateAlerts: boolean
  }
  workflow: {
    stepTimeoutMs: number
    maxRedispatches: number
    rejectRepeatThreshold: number
    enforceAgentScoping: boolean
    enforceWorkflowDoneGuard: boolean
  }
}

const DEFAULTS: BakinSettings = {
  dispatch: {
    intervalMs: 5 * 60 * 1000,
    failureCooldownMs: 30 * 60 * 1000,
    maxDispatched: 500,
    maxRetries: 5,
  },
  watchdog: {
    intervalMs: 5 * 60 * 1000,
    stuckThresholdMs: 30 * 60 * 1000,
    alertChannelId: '1483917792745885768',
    autoRecover: true,
    maxAutoRecoveries: 3,
  },
  calendar: {
    intervalMs: 5 * 60 * 1000,
  },
  sse: {
    maxClients: 50,
    keepAliveMs: 30000,
  },
  openclaw: {
    binaryPath: process.env.OPENCLAW_PATH || '/opt/homebrew/bin/openclaw',
    gatewayUrl: 'http://127.0.0.1',
    gatewayPort: 18789,
  },
  models: {},
  agents: [], // populated dynamically from OpenClaw at load time
  antfly: {
    enabled: false,
    url: 'http://localhost:8080',
  },
  doctor: {
    intervalMs: 30 * 60 * 1000, // 30 minutes
    autoFixSkill: true,
  },
  service: {
    enabled: false,
  },
  notifications: {
    channel: 'none',
    target: '',
    gateAlerts: true,
  },
  workflow: {
    stepTimeoutMs: 60 * 60 * 1000,       // 1 hour
    maxRedispatches: 2,
    rejectRepeatThreshold: 0.95,
    enforceAgentScoping: true,
    enforceWorkflowDoneGuard: true,
  },
}

// Use globalThis to survive Next.js webpack module re-evaluation.
// Without this, resetSettingsCache() in a plugin route handler wouldn't
// bust the cache seen by the custom server's /api/settings handler.
const _g = globalThis as typeof globalThis & {
  __bakinSettingsCache?: BakinSettings | null
  __bakinOpenClawMtime?: number
  __bakinOpenClawAgents?: string[]
}
function getCachedSettings(): BakinSettings | null { return _g.__bakinSettingsCache ?? null }
function setCachedSettings(v: BakinSettings | null) { _g.__bakinSettingsCache = v }

const OPENCLAW_JSON_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json')

/**
 * Read agent IDs from ~/.openclaw/openclaw.json with mtime-based caching.
 * Re-reads when the file changes on disk — picks up agents added via OpenClaw
 * without needing a Bakin restart or explicit cache bust.
 */
function readAgentIdsFromOpenClaw(): string[] {
  const OPENCLAW_TO_BAKIN: Record<string, string> = { main: 'main-operator' }
  try {
    const stat = fs.statSync(OPENCLAW_JSON_PATH)
    if (_g.__bakinOpenClawMtime === stat.mtimeMs && _g.__bakinOpenClawAgents) {
      return _g.__bakinOpenClawAgents
    }
    const config = JSON.parse(fs.readFileSync(OPENCLAW_JSON_PATH, 'utf-8'))
    const list = config?.agents?.list as Array<{ id: string }> | undefined
    if (!Array.isArray(list)) return []
    const agents = list.map((a) => OPENCLAW_TO_BAKIN[a.id] ?? a.id)
    _g.__bakinOpenClawMtime = stat.mtimeMs
    _g.__bakinOpenClawAgents = agents
    return agents
  } catch {
    return []
  }
}

function getSettingsPath(): string {
  return path.join(getContentDir(), 'settings.json')
}

function deepMerge(defaults: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result = { ...defaults }
  for (const key of Object.keys(overrides)) {
    if (
      overrides[key] !== null &&
      typeof overrides[key] === 'object' &&
      !Array.isArray(overrides[key]) &&
      typeof defaults[key] === 'object' &&
      !Array.isArray(defaults[key]) &&
      defaults[key] !== null
    ) {
      result[key] = deepMerge(
        defaults[key] as Record<string, unknown>,
        overrides[key] as Record<string, unknown>
      )
    } else {
      result[key] = overrides[key]
    }
  }
  return result
}

export function getSettings(): BakinSettings {
  let settings = getCachedSettings()

  if (!settings) {
    const settingsPath = getSettingsPath()
    let overrides: Record<string, unknown> = {}

    try {
      if (fs.existsSync(settingsPath)) {
        overrides = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
        log.info('Settings loaded', { path: settingsPath })
      }
    } catch (err) {
      log.warn('Failed to read settings, using defaults', err)
    }

    settings = deepMerge(
      DEFAULTS as unknown as Record<string, unknown>,
      overrides
    ) as unknown as BakinSettings

    setCachedSettings(settings)
  }

  // Always refresh agents from OpenClaw (mtime-cached, cheap when unchanged).
  // This ensures agents added via OpenClaw directly are picked up without
  // needing a Bakin restart or explicit cache bust.
  if (!settings.agents.length || _g.__bakinOpenClawAgents === undefined) {
    settings.agents = readAgentIdsFromOpenClaw()
  } else {
    // Check if openclaw.json changed — mtime comparison is a single stat() call
    try {
      const stat = fs.statSync(OPENCLAW_JSON_PATH)
      if (stat.mtimeMs !== _g.__bakinOpenClawMtime) {
        settings.agents = readAgentIdsFromOpenClaw()
      }
    } catch { /* keep cached agents */ }
  }

  return settings
}

export function updateSettings(partial: Record<string, unknown>): BakinSettings {
  const settingsPath = getSettingsPath()
  const dir = path.dirname(settingsPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  // Read current overrides (not merged defaults)
  let current: Record<string, unknown> = {}
  try {
    if (fs.existsSync(settingsPath)) {
      current = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    }
  } catch {
    // start fresh
  }

  const merged = deepMerge(current, partial)
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf-8')
  log.info('Settings updated', { keys: Object.keys(partial) })

  // Invalidate cache
  setCachedSettings(null)
  return getSettings()
}

export function resetSettingsCache(): void {
  setCachedSettings(null)
}
