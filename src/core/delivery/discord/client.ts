/**
 * Discord transport lifecycle (D2): @discordjs/core REST + gateway, no full
 * discord.js framework, no native optional deps (pure-JS paths — required
 * for `bun build --compile`; verified by the A0 spike). Confined to
 * src/core/delivery/ by the adapter-boundary architecture test.
 */
import { Client, GatewayDispatchEvents, GatewayIntentBits } from '@discordjs/core'
import { REST } from '@discordjs/rest'
import { WebSocketManager } from '@discordjs/ws'
import type { APIEmbed } from 'discord-api-types/v10'
import { createLogger } from '@/core/logger'
import type { ApiChannelLike } from './channel-info'
import type { SendApi } from './send'
import type { ApprovalApi, RawInteraction } from './approvals'
import type { RawInboundMessage } from './inbound'

const log = createLogger('delivery-discord')

const READY_TIMEOUT_MS = 30_000

export interface DiscordTransport {
  /** Typed REST surface (client.api.*) — sends, channel fetches, DMs. */
  api: Client['api']
  /** Raw dispatch subscription — approvals (A5) and inbound (B1) hook here. */
  client: Client
  /** Bot's own user id (known after READY) — self-message filtering. */
  botUserId(): string | null
  /** Application id (known after READY) — slash-command registration. */
  applicationId(): string | null
  connect(): Promise<void>
  destroy(): Promise<void>
  fetchGuildChannels(guildId: string): Promise<ApiChannelLike[]>
}

export function createDiscordTransport(token: string): DiscordTransport {
  const rest = new REST({ version: '10' }).setToken(token)
  const gateway = new WebSocketManager({
    token,
    // Message intents exist for the inbound-chat consumer (B1). NOTE:
    // MessageContent is PRIVILEGED — a bot without the portal toggle gets a
    // 4014 close at identify and the whole bridge fails; the delivery.discord
    // doctor remediation names the toggle.
    intents:
      GatewayIntentBits.Guilds |
      GatewayIntentBits.GuildMessages |
      GatewayIntentBits.DirectMessages |
      GatewayIntentBits.MessageContent,
    rest,
  })
  const client = new Client({ rest, gateway })
  let botUserId: string | null = null
  let applicationId: string | null = null
  let connected = false

  client.once(GatewayDispatchEvents.Ready, ({ data }) => {
    botUserId = data.user.id
    applicationId = data.application.id
    log.info('Discord gateway ready', { user: data.user.username, guilds: data.guilds.length })
  })

  return {
    api: client.api,
    client,
    botUserId: () => botUserId,
    applicationId: () => applicationId,

    async connect() {
      if (connected) return
      let readyTimeout: ReturnType<typeof setTimeout> | undefined
      const ready = new Promise<void>((resolve, reject) => {
        readyTimeout = setTimeout(
          () => reject(new Error(`Discord gateway not READY within ${READY_TIMEOUT_MS}ms`)),
          READY_TIMEOUT_MS,
        )
        client.once(GatewayDispatchEvents.Ready, () => {
          clearTimeout(readyTimeout)
          resolve()
        })
      })
      // Observe the rejection even when gateway.connect() throws first —
      // otherwise the orphaned timeout fires 30s later as an unhandled
      // promise rejection.
      ready.catch(() => {})
      try {
        await gateway.connect()
        await ready
        connected = true
      } catch (err) {
        // A failed/timed-out connect must not leave a zombie WebSocketManager
        // retrying in the background (it would hold an identify session while
        // the doctor honestly reports "not connected").
        clearTimeout(readyTimeout)
        try {
          await gateway.destroy()
        } catch (destroyErr) {
          log.warn('Gateway teardown after failed connect also failed', destroyErr)
        }
        throw err
      }
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

/** Bind the neutral SendApi (see send.ts) to the live transport. */
export function sendApiFromTransport(transport: DiscordTransport): SendApi {
  return {
    async createMessage(channelId, payload) {
      const message = await transport.api.channels.createMessage(channelId, {
        ...(payload.content ? { content: payload.content } : {}),
        ...(payload.embeds ? { embeds: payload.embeds as APIEmbed[] } : {}),
        ...(payload.components ? { components: payload.components as never } : {}),
        ...(payload.files?.length
          ? { files: payload.files.map(file => ({ name: file.name, data: file.data, contentType: file.contentType })) }
          : {}),
      })
      return { id: message.id }
    },
    async editMessage(channelId, messageId, body) {
      await transport.api.channels.editMessage(channelId, messageId, { content: body })
    },
    async startThread(channelId, name, messageId) {
      // 11 = PublicThread (required when the thread is not anchored to a message).
      const thread = messageId
        ? await transport.api.channels.createThread(channelId, { name }, messageId)
        : await transport.api.channels.createThread(channelId, { name, type: 11 })
      return { id: thread.id }
    },
    async createDM(userId) {
      const channel = await transport.api.users.createDM(userId)
      return { id: channel.id }
    },
    async showTyping(channelId) {
      await transport.api.channels.showTyping(channelId)
    },
  }
}

/** Bind the interaction-response surface (see approvals.ts) to the transport. */
export function approvalApiFromTransport(transport: DiscordTransport): ApprovalApi {
  return {
    async replyEphemeral(interactionId, token, content) {
      // 64 = MessageFlags.Ephemeral
      await transport.api.interactions.reply(interactionId, token, { content, flags: 64 })
    },
    async updateComponentMessage(interactionId, token, payload) {
      await transport.api.interactions.updateMessage(interactionId, token, payload as never)
    },
    async openModal(interactionId, token, modal) {
      await transport.api.interactions.createModal(interactionId, token, modal as never)
    },
    async editMessage(channelId, messageId, payload) {
      await transport.api.channels.editMessage(channelId, messageId, payload as never)
    },
  }
}

/** Forward raw INTERACTION_CREATE payloads (buttons + modal submits). */
export function subscribeInteractions(transport: DiscordTransport, handler: (raw: RawInteraction) => void): void {
  transport.client.on(GatewayDispatchEvents.InteractionCreate, ({ data }) => {
    handler(data as unknown as RawInteraction)
  })
}

/** Forward raw MESSAGE_CREATE payloads to the inbound surface (B1). */
export function subscribeMessages(transport: DiscordTransport, handler: (raw: RawInboundMessage) => void): void {
  transport.client.on(GatewayDispatchEvents.MessageCreate, ({ data }) => {
    handler(data as unknown as RawInboundMessage)
  })
}

/** Fetch an attachment URL to bytes — CDN semantics stay confined here. */
export async function downloadAttachment(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`attachment fetch failed: ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/**
 * Register the bridge's guild slash commands (idempotent bulk overwrite).
 * Non-fatal: a registration failure degrades to "no slash commands", never
 * a failed boot.
 */
export async function registerGuildCommands(transport: DiscordTransport, guildIds: string[], commands: Array<{ name: string; description: string }>): Promise<void> {
  const applicationId = transport.applicationId()
  if (!applicationId) {
    log.warn('Slash-command registration skipped — application id unknown (no READY yet)')
    return
  }
  for (const guildId of guildIds) {
    try {
      await transport.api.applicationCommands.bulkOverwriteGuildCommands(
        applicationId,
        guildId,
        commands.map(command => ({ ...command, type: 1 })),
      )
    } catch (err) {
      log.warn('Slash-command registration failed for guild', err, { guildId })
    }
  }
}
