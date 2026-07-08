/**
 * Pi-private settings helpers over <pi-home>/agent/settings.json.
 *
 * The contract's config surface is GONE (P2.5) — these helpers back the
 * adapter-internal reads: credentialStatus() provider names from auth.json
 * and the routing.defaultModel knob (P2.3).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'

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

export function writePiSettings(next: Record<string, unknown>): void {
  mkdirSync(getPiAgentDir(), { recursive: true })
  const tmp = `${settingsPath()}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2))
  renameSync(tmp, settingsPath())
}

/**
 * Routing policy (P2.3): Pi honors ONE knob — `routing.defaultModel` in
 * settings.json, used at session build when an agent has no model. Fallbacks,
 * aliases, and subagent models have no Pi session semantics and are rejected
 * by setRoutingPolicy (never silently stored).
 */
export function readRoutingDefaultModel(): string {
  const routing = readPiSettings().routing
  if (routing && typeof routing === 'object') {
    const value = (routing as Record<string, unknown>).defaultModel
    if (typeof value === 'string') return value
  }
  return ''
}

export function writeRoutingDefaultModel(defaultModel: string): void {
  const settings = readPiSettings()
  const routing = (settings.routing && typeof settings.routing === 'object')
    ? { ...(settings.routing as Record<string, unknown>) }
    : {}
  routing.defaultModel = defaultModel
  writePiSettings({ ...settings, routing })
}
