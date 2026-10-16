/**
 * Discord transport lifecycle (D2): @discordjs/core REST + gateway, no full
 * discord.js framework, no native optional deps (pure-JS paths — required
 * for `bun build --compile`; verified by the A0 spike). Confined to
 * src/core/delivery/ by the adapter-boundary architecture test.
 *
 * Status model (channel-readiness #908): the transport OWNS its phase and
 * emits typed events (ready / resumed / closed / error) the bridge folds
 * into BridgeStatus. Shard listeners are attached at construction — the
 * manager is an async event emitter that THROWS on an unhandled `error`
 * and a fatal close (4004 bad token, 4014 disallowed intents) would
 * otherwise leave `gateway.connect()` hanging until the READY timer. A
 * fatal close rejects the READY gate immediately with the real cause.
 */
import { Client, GatewayDispatchEvents, GatewayIntentBits } from '@discordjs/core'
import { REST } from '@discordjs/rest'
import { WebSocketManager, WebSocketShardEvents } from '@discordjs/ws'
import type { APIEmbed } from 'discord-api-types/v10'
import { DeliveryError, summarizeDeliveryError, type DeliveryErrorSummary } from '@bakin/core/delivery'
import { createLogger } from '@/core/logger'
import type { ApiChannelLike } from './channel-info'
import { classifyConnectFailure, closeMessage, isFatalCloseCode, FATAL_CLOSE_KINDS } from './errors'
import type { SendApi } from './send'
import type { ApprovalApi, RawInteraction } from './approvals'
import type { RawInboundMessage } from './inbound'

const log = createLogger('delivery-discord')

export const READY_TIMEOUT_MS = 30_000

export interface TransportStatus {
  phase: 'idle' | 'connecting' | 'ready' | 'disconnected' | 'closed'
  botUser: { id: string; name: string } | null
  /** Guild ids from the last READY payload. */
  readyGuildIds: string[]
  lastCloseCode: number | null
  lastError: DeliveryErrorSummary | null
}

export type TransportEvent =
  | { type: 'ready'; guildIds: string[]; botUser: { id: string; name: string } }
  | { type: 'resumed' }
  | { type: 'closed'; code: number; fatal: boolean }
  | { type: 'error'; error: DeliveryError }

export interface DiscordTransport {
  /** Typed REST surface (client.api.*) — sends, channel fetches, DMs. */
  api: Client['api']
  /** Raw dispatch subscription — approvals (A5) and inbound (B1) hook here. */
  client: Client
  /** Bot's own user id (known after READY) — self-message filtering. */
  botUserId(): string | null
  /** Application id (known after READY) — slash-command registration. */
  applicationId(): string | null
  /** Resolves on READY; rejects with a classified DeliveryError (and the manager destroyed). */
  connect(opts?: { signal?: AbortSignal }): Promise<void>
  /** Idempotent; always destroys the manager so nothing keeps identifying in the background. */
  destroy(): Promise<void>
  status(): TransportStatus
  subscribe(listener: (event: TransportEvent) => void): () => void
  fetchGuildChannels(guildId: string): Promise<ApiChannelLike[]>
}

export interface TransportOptions {
  readyTimeoutMs?: number
}

export function createDiscordTransport(token: string, options: TransportOptions = {}): DiscordTransport {
  const readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS
  const rest = new REST({ version: '10' }).setToken(token)
  const gateway = new WebSocketManager({
    token,
    // Message intents exist for the inbound-chat consumer (B1). NOTE:
    // MessageContent is PRIVILEGED — a bot without the portal toggle gets a
    // 4014 close at identify; the bridge classifies it as `intents` and the
    // doctor remediation names the toggle.
    intents:
      GatewayIntentBits.Guilds |
      GatewayIntentBits.GuildMessages |
      GatewayIntentBits.DirectMessages |
      GatewayIntentBits.MessageContent,
    rest,
  })
  const client = new Client({ rest, gateway })

  let phase: TransportStatus['phase'] = 'idle'
  let botUser: TransportStatus['botUser'] = null
  let applicationId: string | null = null
  let readyGuildIds: string[] = []
  let lastCloseCode: number | null = null
  let lastError: DeliveryErrorSummary | null = null
  let disposed = false
  let readyGate: { resolve(): void; reject(err: DeliveryError): void } | null = null
  const listeners = new Set<(event: TransportEvent) => void>()

  const emit = (event: TransportEvent) => {
    if (disposed) return
    for (const listener of listeners) {
      try {
        listener(event)
      } catch (err) {
        log.error('Discord transport listener failed', err, { event: event.type })
      }
    }
  }

  const fail = (error: DeliveryError) => {
    lastError = summarizeDeliveryError(error)
    phase = 'closed'
    readyGate?.reject(error)
  }

  // Attached at construction, BEFORE connect(): the `error` listener is
  // load-bearing (see the module header).
  gateway.on(WebSocketShardEvents.Closed, (code) => {
    if (disposed) return
    lastCloseCode = code
    const fatal = isFatalCloseCode(code)
    if (fatal) {
      fail(new DeliveryError(FATAL_CLOSE_KINDS[code], closeMessage(code), { status: code }))
    } else {
      phase = 'disconnected'
    }
    emit({ type: 'closed', code, fatal })
  })
  gateway.on(WebSocketShardEvents.Error, (error) => {
    if (disposed) return
    if (!isFatalCloseCode(lastCloseCode)) {
      // The shard recovers from non-fatal errors itself; stay observable.
      log.warn('Discord gateway error', error)
      return
    }
    const typed = new DeliveryError(FATAL_CLOSE_KINDS[lastCloseCode], closeMessage(lastCloseCode), { status: lastCloseCode })
    fail(typed)
    emit({ type: 'error', error: typed })
  })
  gateway.on(WebSocketShardEvents.Ready, (data) => {
    if (disposed) return
    botUser = { id: data.user.id, name: data.user.username }
    applicationId = data.application.id
    readyGuildIds = data.guilds.map((guild) => guild.id)
    phase = 'ready'
    lastCloseCode = null
    lastError = null
    log.info('Discord gateway ready', { user: data.user.username, guilds: readyGuildIds.length })
    readyGate?.resolve()
    emit({ type: 'ready', guildIds: readyGuildIds, botUser })
  })
  gateway.on(WebSocketShardEvents.Resumed, () => {
    if (disposed) return
    phase = 'ready'
    emit({ type: 'resumed' })
  })

  async function destroy(): Promise<void> {
    if (disposed) return
    disposed = true
    phase = 'closed'
    readyGate = null
    try {
      await gateway.destroy()
      log.info('Discord gateway disconnected')
    } catch (err) {
      log.warn('Discord gateway teardown failed', err)
    }
  }

  return {
    api: client.api,
    client,
    botUserId: () => botUser?.id ?? null,
    applicationId: () => applicationId,

    async connect(opts = {}) {
      if (phase === 'ready') return
      if (disposed) throw new DeliveryError('transport', 'Discord transport already destroyed')
      phase = 'connecting'
      let timer: ReturnType<typeof setTimeout> | undefined
      const onAbort = () => fail(new DeliveryError('transport', 'Discord connect aborted'))
      const gate = new Promise<void>((resolve, reject) => {
        readyGate = { resolve, reject }
        timer = setTimeout(
          () => fail(new DeliveryError('timeout', `Discord gateway not READY within ${readyTimeoutMs}ms`)),
          readyTimeoutMs,
        )
        if (opts.signal?.aborted) onAbort()
        else opts.signal?.addEventListener('abort', onAbort, { once: true })
      })
      // Observe the rejection even when gateway.connect() throws first —
      // otherwise the orphaned gate rejects later as an unhandled rejection.
      gate.catch(() => {})
      try {
        // RACE, not sequence: gateway.connect() can reject (REST 401 from
        // GET /gateway/bot on a bad token) or hang (fatal close during
        // identify) — the gate is what carries the real cause.
        await Promise.race([gateway.connect(), gate])
        await gate
      } catch (err) {
        const failure = classifyConnectFailure(err, lastCloseCode, token)
        lastError = summarizeDeliveryError(failure)
        // A failed/timed-out connect must not leave a zombie WebSocketManager
        // retrying in the background (it would hold an identify session while
        // the doctor honestly reports "not connected").
        await destroy()
        throw failure
      } finally {
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        readyGate = null
      }
    },

    destroy,

    status: () => ({ phase, botUser, readyGuildIds, lastCloseCode, lastError }),

    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
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
 * Register the bridge's slash commands GLOBALLY (upsert by name — never a
 * bulk overwrite, so OpenClaw's own registered commands survive for a
 * switch back). Global scope is required: guild commands are invisible in
 * DMs, and DM chats need /new-chat the most. Guild registrations from
 * earlier boots are cleared (they were bridge-owned only). Non-fatal: a
 * registration failure degrades to "no slash commands", never a failed
 * connect. The bridge memoizes it per (application, guild set) and runs it
 * post-apply so a reconnect never re-spends Discord's daily create budget.
 */
export async function registerGlobalCommands(transport: DiscordTransport, guildIds: string[], commands: Array<{ name: string; description: string }>): Promise<void> {
  const applicationId = transport.applicationId()
  if (!applicationId) {
    log.warn('Slash-command registration skipped — application id unknown (no READY yet)')
    return
  }
  // GET-then-diff: skip creates when already registered (createGlobalCommand
  // upserts, but every boot-create counts against Discord's daily limits).
  let existingGlobal = new Set<string>()
  try {
    existingGlobal = new Set((await transport.api.applicationCommands.getGlobalCommands(applicationId)).map(c => c.name))
  } catch (err) {
    log.warn('Global slash-command listing failed — will upsert blindly', err)
  }
  for (const command of commands) {
    if (existingGlobal.has(command.name)) continue
    try {
      await transport.api.applicationCommands.createGlobalCommand(applicationId, { ...command, type: 1 })
    } catch (err) {
      log.warn('Global slash-command registration failed', err, { command: command.name })
    }
  }
  // Remove the bridge's earlier per-guild registrations (they would render
  // as duplicates beside the global command) — SURGICALLY, by name: a
  // blanket overwrite could clobber guild commands another consumer of this
  // application (OpenClaw) registered (review finding).
  const bridgeNames = new Set(commands.map(c => c.name))
  for (const guildId of guildIds) {
    try {
      const guildCommands = await transport.api.applicationCommands.getGuildCommands(applicationId, guildId)
      for (const guildCommand of guildCommands) {
        if (!bridgeNames.has(guildCommand.name)) continue
        await transport.api.applicationCommands.deleteGuildCommand(applicationId, guildId, guildCommand.id)
      }
    } catch (err) {
      log.warn('Guild slash-command cleanup failed', err, { guildId })
    }
  }
}
