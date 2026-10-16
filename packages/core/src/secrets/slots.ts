/**
 * Declared secret slots (channel-readiness spec §4.4).
 *
 * ONE table of the named secrets Bakin itself knows about: label, owning
 * settings surface, env-var precedence, and whether the value is injected
 * into process.env at boot. Presence/status resolution lives here and is
 * safe for any surface; VALUE resolution is the separate
 * `./slot-value` path used only by transports.
 */
import { getStoredSecret } from '../media/secret-store'

export interface SecretSlotDef {
  provider: string
  name: string
  label: string
  description: string
  /** Env var that wins over the store when set. */
  envVar?: string
  /**
   * Whether boot injects the stored value into process.env under `envVar`.
   * The Discord token is NEVER injected: agent shells inherit the server
   * env (the antfly-password precedent).
   */
  injectEnv: boolean
  /** Where the owner manages it. */
  owner: { label: string; href: string }
}

export const SECRET_SLOT = {
  discordBotToken: {
    provider: 'discord',
    name: 'botToken',
    label: 'Discord bot token',
    description: 'Bot token for the Bakin delivery bridge (used when the active runtime has no native Discord delivery).',
    envVar: 'DISCORD_BOT_TOKEN',
    injectEnv: false,
    owner: { label: 'Settings → Channels', href: '/settings?tab=channels' },
  },
  braveApiKey: {
    provider: 'brave',
    name: 'apiKey',
    label: 'Brave Search API key',
    description: 'Injected as BRAVE_SEARCH_API_KEY for web-search capability packs.',
    envVar: 'BRAVE_SEARCH_API_KEY',
    injectEnv: true,
    owner: { label: 'Settings → Integrations & Keys', href: '/settings?tab=integrations' },
  },
} as const satisfies Record<string, SecretSlotDef>

export const SECRET_SLOTS: readonly SecretSlotDef[] = Object.values(SECRET_SLOT)

export interface SecretSlotStatus {
  present: boolean
  source: 'env' | 'store' | null
}

export function findSecretSlot(provider: string, name: string): SecretSlotDef | null {
  return SECRET_SLOTS.find((slot) => slot.provider === provider && slot.name === name) ?? null
}

function envValue(def: SecretSlotDef): string | null {
  if (!def.envVar) return null
  const raw = process.env[def.envVar]?.trim()
  return raw ? raw : null
}

/** Presence + source only. Never returns the value. */
export function resolveSecretSlotStatus(def: SecretSlotDef): SecretSlotStatus {
  if (envValue(def)) return { present: true, source: 'env' }
  if (getStoredSecret(def.provider, def.name)) return { present: true, source: 'store' }
  return { present: false, source: null }
}
