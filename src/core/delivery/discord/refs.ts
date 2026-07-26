/**
 * Discord channel-ref parsing. Refs arrive from consumers in the neutral
 * `provider:target` shape the alias resolver passes through:
 *   discord:channel:<id>   — guild channel or thread
 *   discord:user:<id>      — DM to a user (D3)
 * The provider prefix is optional by the time a ref reaches the bridge
 * (thread channelRefs the bridge mints are always fully qualified).
 */

export interface DiscordRef {
  kind: 'channel' | 'user'
  id: string
}

const REF_HINT = 'Use "discord:channel:<id>" for a channel/thread or "discord:user:<id>" for a DM.'

export function parseDiscordRef(ref: string): DiscordRef {
  const parts = ref.trim().split(':').filter(part => part.length > 0)
  if (parts[0] === 'discord') parts.shift()
  const [kind, ...idParts] = parts
  const id = idParts.join(':')
  if ((kind === 'channel' || kind === 'user') && id.length > 0) {
    return { kind, id }
  }
  throw new Error(`Unrecognized Discord channel ref "${ref}". ${REF_HINT}`)
}

export function discordChannelRef(channelId: string): string {
  return `discord:channel:${channelId}`
}
