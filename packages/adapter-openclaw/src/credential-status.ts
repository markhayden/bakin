/**
 * Presence-only credential report (P2.2) — relocated from core's onboarding
 * credentials component so OpenClaw's credential SHAPES never leak upstream.
 *
 * llmProviders: read from the agent's auth-profiles.json (the per-agent
 * profile store). Three shapes exist in the wild:
 *   1. Bare array:   [{ provider, apiKey }]
 *   2. Object+array: { profiles: [{ provider }] }
 *   3. Object+dict:  { profiles: { key: { provider } } }
 * channels: read from config.channels — a channel counts when any known
 * credential field is a non-empty string.
 *
 * Names only — credential VALUES are only ever length-tested, never returned.
 */
import { existsSync, readFileSync } from 'fs'

import { getOpenClawPath } from './home'
import { readOpenClawConfig } from './config'
import { tryGetMainAgentId } from './main-agent'

const CHANNEL_CREDENTIAL_FIELDS = ['token', 'apiKey', 'api_key', 'botToken', 'bot_token']
const LLM_CREDENTIAL_FIELDS = ['apiKey', 'api_key', 'token', 'access', 'refresh']

function hasChannelCredential(entry: unknown): boolean {
  if (entry === null || typeof entry !== 'object') return false
  const obj = entry as Record<string, unknown>
  return CHANNEL_CREDENTIAL_FIELDS.some(
    (field) => typeof obj[field] === 'string' && (obj[field] as string).trim().length > 0,
  )
}

/** Provider name when the entry carries a usable credential; null otherwise. */
function authProvider(entry: unknown): string | null {
  if (entry === null || typeof entry !== 'object') return null
  const obj = entry as Record<string, unknown>
  const provider = obj.provider
  if (typeof provider !== 'string' || provider.trim().length === 0) return null
  const usable = LLM_CREDENTIAL_FIELDS.some(
    (field) => typeof obj[field] === 'string' && (obj[field] as string).trim().length > 0,
  )
  return usable ? provider : null
}

/** Flatten the three auth-profile shapes into entry objects. */
function normalizeAuthProfiles(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (parsed !== null && typeof parsed === 'object') {
    const inner = (parsed as Record<string, unknown>).profiles
    if (Array.isArray(inner)) return inner
    if (inner !== null && typeof inner === 'object') return Object.values(inner as Record<string, unknown>)
  }
  return []
}

/**
 * Providers from `models auth list --json` — the sqlite-era store. Newer
 * OpenClaw migrated auth-profiles.json into openclaw-agent.sqlite (a
 * `.sqlite-import.<ts>.bak` marks the migration), so the JSON probe returns
 * nothing on migrated installs; the CLI is the supported presence-only read.
 */
export async function listLlmProvidersViaCli(
  exec: (args: string[]) => Promise<string>,
  agentId?: string,
): Promise<string[]> {
  const args = ['models', 'auth', 'list', '--json']
  const agent = agentId?.trim()
  if (agent) args.push('--agent', agent)
  const parsed = JSON.parse(await exec(args)) as { profiles?: Array<{ provider?: unknown }> }
  const providers = (parsed.profiles ?? [])
    .map((profile) => (typeof profile.provider === 'string' ? profile.provider.trim() : ''))
    .filter((provider) => provider.length > 0)
  return [...new Set(providers)]
}

/** Providers with usable credentials in the agent's auth-profiles.json. */
export function listLlmProviders(agentId?: string): string[] {
  const agent = agentId?.trim() || tryGetMainAgentId() || 'main'
  const profilePath = getOpenClawPath('agents', agent, 'agent', 'auth-profiles.json')
  if (!existsSync(profilePath)) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(profilePath, 'utf-8'))
  } catch {
    return []
  }
  const providers = normalizeAuthProfiles(parsed)
    .map(authProvider)
    .filter((provider): provider is string => provider !== null)
  return [...new Set(providers)]
}

/** Channel names with a usable credential in config.channels. */
export function listConfiguredChannels(): string[] {
  const config = readOpenClawConfig() as { channels?: unknown } | null
  const channels = config?.channels
  if (channels === null || channels === undefined || typeof channels !== 'object') return []
  return Object.entries(channels as Record<string, unknown>)
    .filter(([, entry]) => hasChannelCredential(entry))
    .map(([name]) => name)
}

export const _internals = { CHANNEL_CREDENTIAL_FIELDS, LLM_CREDENTIAL_FIELDS, authProvider, normalizeAuthProfiles, hasChannelCredential }
