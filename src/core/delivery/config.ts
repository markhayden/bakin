/**
 * Discord bridge configuration (#669).
 *
 * Non-secret config lives at `settings.integrations.discord` (broadcast by
 * GET /api/settings); the bot token lives in the secret store as
 * `discord.botToken` (declared in the secret-slot registry) and is read
 * env-first through the private slot-value path — it is NEVER injected into
 * `process.env` (agent shells inherit the server env; the antfly-password
 * pattern is the precedent).
 */
import { SECRET_SLOT } from '@bakin/core/secrets'
import { readSecretSlotValue } from '@bakin/core/secrets/slot-value'
import { getSettings, type DiscordIntegrationSettings } from '@/core/settings'

export const DISCORD_TOKEN_ENV_VAR = SECRET_SLOT.discordBotToken.envVar

export interface DiscordBridgeConfig {
  settings: DiscordIntegrationSettings
  /** Resolved bot token (env-first, then secret store), or null. */
  token: string | null
}

export function readDiscordConfig(): DiscordBridgeConfig {
  const settings = getSettings().integrations.discord
  return { settings, token: readSecretSlotValue(SECRET_SLOT.discordBotToken) }
}

/**
 * The single "is the bridge on" predicate: owner opted in, transport secret
 * present, and at least one guild to serve. Side-effect-free — adapters call
 * this to decide whether to expose `channels` and report `'shimmed'`.
 */
export function isDiscordConfigured(): boolean {
  const { settings, token } = readDiscordConfig()
  return settings.enabled && Boolean(token) && settings.guildIds.length > 0
}
