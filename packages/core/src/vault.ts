/**
 * Credential vault for Bakin.
 * Reads sensitive credentials once at startup, caches in memory.
 * No credential is ever serialized to an API response.
 */
import fs from 'fs'
import { createLogger } from './logger'
import { getOpenClawPath } from './openclaw-home'
import { tryGetMainAgentId } from './main-agent'

const log = createLogger('vault')

interface VaultEntry {
  value: string
  source: string
}

const store = new Map<string, VaultEntry>()
let initialized = false

/**
 * Load credentials from known locations.
 * Called once at startup.
 */
export function initialize(): void {
  if (initialized) return
  initialized = true

  // OpenClaw gateway token
  loadFromOpenClawConfig()

  // Anthropic API key
  loadFromAuthProfiles()

  log.info('Vault initialized', { credentialCount: store.size })
}

function loadFromOpenClawConfig(): void {
  const configPath = getOpenClawPath('openclaw.json')

  try {
    if (!fs.existsSync(configPath)) return
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

    if (config?.gateway?.auth?.token) {
      store.set('gateway-token', {
        value: config.gateway.auth.token,
        source: configPath,
      })
    }

    // Discord bot token
    if (config?.channels?.discord?.token) {
      store.set('discord-token', {
        value: config.channels.discord.token,
        source: configPath,
      })
    }

    // Skill API keys
    if (config?.skills?.entries) {
      for (const [name, skill] of Object.entries(config.skills.entries)) {
        const s = skill as Record<string, unknown>
        if (s.apiKey) {
          store.set(`skill-${name}`, {
            value: s.apiKey as string,
            source: configPath,
          })
        }
      }
    }
  } catch (err) {
    log.warn('Failed to read OpenClaw config for vault', err)
  }
}

function loadFromAuthProfiles(): void {
  const mainId = tryGetMainAgentId()
  if (!mainId) return
  const profilePath = getOpenClawPath('agents', mainId, 'agent', 'auth-profiles.json')

  try {
    if (!fs.existsSync(profilePath)) return
    const profiles = JSON.parse(fs.readFileSync(profilePath, 'utf-8'))

    // Look for Anthropic key in profiles
    if (Array.isArray(profiles)) {
      for (const profile of profiles) {
        if (profile.provider === 'anthropic' && profile.apiKey) {
          store.set('anthropic-api-key', {
            value: profile.apiKey,
            source: profilePath,
          })
          break
        }
      }
    }
  } catch (err) {
    log.warn('Failed to read auth profiles for vault', err)
  }
}

/**
 * Get a credential by key. Returns null if not found.
 * Auto-initializes on first call, so any entry point (server, MCP, plugin
 * handler) can use it without explicit setup.
 */
export function get(key: string): string | null {
  if (!initialized) initialize()
  const entry = store.get(key)
  return entry?.value ?? null
}

/**
 * Check if a credential exists.
 */
export function has(key: string): boolean {
  return store.has(key)
}

/**
 * Set a credential at runtime (e.g., from plugin registration).
 */
export function set(key: string, value: string, source: string = 'runtime'): void {
  store.set(key, { value, source })
}

/**
 * List credential keys (never values) for debugging.
 */
export function listKeys(): string[] {
  return [...store.keys()]
}

/**
 * Create a scoped vault accessor for a plugin.
 * Only returns credentials the plugin is allowed to access.
 */
export function createPluginVault(allowedKeys: string[]): { get(key: string): string | null } {
  const allowedSet = new Set(allowedKeys)
  return {
    get(key: string): string | null {
      if (!allowedSet.has(key)) {
        log.warn('Plugin vault access denied', { key })
        return null
      }
      return get(key)
    },
  }
}
