/**
 * Discord transport lifecycle (D2): @discordjs/core REST + gateway, no full
 * discord.js framework, no native optional deps (pure-JS paths — required
 * for `bun build --compile`; verified by the A0 spike). Confined to
 * src/core/delivery/ by the adapter-boundary architecture test.
 */
import { Client, GatewayDispatchEvents, GatewayIntentBits } from '@discordjs/core'
import { REST } from '@discordjs/rest'
import { WebSocketManager } from '@discordjs/ws'
import { createLogger } from '@/core/logger'
import type { ApiChannelLike } from './channel-info'

const log = createLogger('delivery-discord')

const READY_TIMEOUT_MS = 30_000

export interface DiscordTransport {
  /** Typed REST surface (client.api.*) — sends, channel fetches, DMs. */
  api: Client['api']
  /** Raw dispatch subscription — approvals (A5) and inbound (B1) hook here. */
  client: Client
  /** Bot's own user id (known after READY) — self-message filtering. */
  botUserId(): string | null
  connect(): Promise<void>
  destroy(): Promise<void>
  fetchGuildChannels(guildId: string): Promise<ApiChannelLike[]>
}

export function createDiscordTransport(token: string): DiscordTransport {
  const rest = new REST({ version: '10' }).setToken(token)
  const gateway = new WebSocketManager({
    token,
    intents:
      GatewayIntentBits.Guilds |
      GatewayIntentBits.GuildMessages |
      GatewayIntentBits.DirectMessages |
      GatewayIntentBits.MessageContent,
    rest,
  })
  const client = new Client({ rest, gateway })
  let botUserId: string | null = null
  let connected = false

  client.once(GatewayDispatchEvents.Ready, ({ data }) => {
    botUserId = data.user.id
    log.info('Discord gateway ready', { user: data.user.username, guilds: data.guilds.length })
  })

  return {
    api: client.api,
    client,
    botUserId: () => botUserId,

    async connect() {
      if (connected) return
      const ready = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Discord gateway not READY within ${READY_TIMEOUT_MS}ms`)),
          READY_TIMEOUT_MS,
        )
        client.once(GatewayDispatchEvents.Ready, () => {
          clearTimeout(timeout)
          resolve()
        })
      })
      await gateway.connect()
      await ready
      connected = true
    },

    async destroy() {
      if (!connected) return
      connected = false
      await gateway.destroy()
      log.info('Discord gateway disconnected')
    },

    async fetchGuildChannels(guildId: string) {
      const channels = await client.api.guilds.getChannels(guildId)
      return channels.map(channel => ({
        id: channel.id,
        name: 'name' in channel ? channel.name : null,
        type: channel.type as number,
      }))
    },
  }
}
