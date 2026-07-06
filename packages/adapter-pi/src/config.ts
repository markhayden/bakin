/**
 * config.* contract implementation over <pi-home>/agent/settings.json.
 *
 * The raw-key surface additionally answers the two onboarding-check keys
 * the credentials component reads through the governed gate:
 *   - `agents.<id>.authProfiles` — synthesized presence-only view of Pi's
 *     auth.json (provider names only, NEVER credential material).
 *   - `channels` — Pi has no channel layer: honest `{}`.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'

import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { getPiAgentDir, getPiPath } from './home'

function settingsPath(): string {
  return getPiPath('agent', 'settings.json')
}

function authPath(): string {
  return getPiPath('agent', 'auth.json')
}

export function readPiSettings(): Record<string, unknown> {
  if (!existsSync(settingsPath())) return {}
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf-8')) as Record<string, unknown>
  } catch (err) {
    throw new Error(`adapter-pi: settings.json unreadable: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Provider names present in Pi's auth.json — presence only, no secrets. */
export function listAuthProviders(): string[] {
  if (!existsSync(authPath())) return []
  try {
    return Object.keys(JSON.parse(readFileSync(authPath(), 'utf-8')) as Record<string, unknown>)
  } catch {
    return []
  }
}

function lookupKeyPath(config: Record<string, unknown>, key: string): unknown {
  let node: unknown = config
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

export function createConfigSurface(): AgentRuntimeAdapter['config'] {
  return {
    async get<T = Record<string, unknown>>(): Promise<T> {
      return readPiSettings() as T
    },

    async replace<T = Record<string, unknown>>(next: T, _reason: string): Promise<void> {
      mkdirSync(getPiAgentDir(), { recursive: true })
      const tmp = `${settingsPath()}.tmp`
      writeFileSync(tmp, JSON.stringify(next, null, 2))
      renameSync(tmp, settingsPath())
    },

    async raw<T = unknown>(key: string, _reason: string): Promise<T> {
      // Onboarding-check synthesis (see module doc).
      const authProfilesMatch = /^agents\.[^.]+\.authProfiles$/.exec(key)
      if (authProfilesMatch) {
        const providers = listAuthProviders()
        // Same shape idea as OpenClaw's authProfiles map: provider → marker.
        return Object.fromEntries(providers.map((p) => [p, { provider: p, configured: true }])) as T
      }
      if (key === 'channels') {
        return {} as T
      }
      if (key === '*') {
        return readPiSettings() as T
      }
      return lookupKeyPath(readPiSettings(), key) as T
    },
  }
}
