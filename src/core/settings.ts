/**
 * Core settings system for Beacon.
 * Reads from content/.beacon/settings.json with defaults for all values.
 */
import fs from 'fs'
import path from 'path'
import { createLogger } from './logger'
import { getContentDir } from './content-dir'

const log = createLogger('settings')

export interface BeaconSettings {
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

const DEFAULTS: BeaconSettings = {
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
  agents: ['roscoe', 'patch', 'pixel', 'rolo', 'basil', 'scout', 'nemo', 'zen'],
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

let cachedSettings: BeaconSettings | null = null

function getSettingsPath(): string {
  return path.join(getContentDir(), '.beacon', 'settings.json')
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

export function getSettings(): BeaconSettings {
  if (cachedSettings) return cachedSettings

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

  cachedSettings = deepMerge(
    DEFAULTS as unknown as Record<string, unknown>,
    overrides
  ) as unknown as BeaconSettings

  return cachedSettings
}

export function updateSettings(partial: Record<string, unknown>): BeaconSettings {
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
  cachedSettings = null
  return getSettings()
}

export function resetSettingsCache(): void {
  cachedSettings = null
}
