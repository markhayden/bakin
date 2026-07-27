/**
 * Inbound Discord messages → neutral InboundChannelMessage events (#669 B1).
 *
 * ALL gating lives here, before anything crosses the neutral contract (D9):
 * bot/self messages are silently ignored; guild messages require an
 * @mention (unless requireMention is off; DMs are exempt); the sender must
 * be on the allowFrom allowlist — EMPTY LIST DENIES EVERYONE (fail closed),
 * and denials are audited (`delivery.inbound_denied`), never answered.
 *
 * Image attachments are materialized to local temp files so consumers never
 * touch Discord CDN URLs (provider semantics stay confined here). A failed
 * download degrades to text-only — a message is never dropped over media.
 */
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { InboundChannelAttachment, InboundChannelMessage } from '@bakin/core/adapters/runtime'
import type { DiscordIntegrationSettings } from '@/core/settings'
import { createLogger } from '@/core/logger'
import { auditDelivery } from '../audit'
import { discordChannelRef } from './refs'

const log = createLogger('delivery-inbound')

/** Per-file cap for downloaded inbound images (matches chat's practical bounds). */
export const INBOUND_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

// The bridge materializes EVERY attachment type — lane selection (image
// input vs. file-on-disk for tool access) is the CONSUMER's call; only
// size and fetchability gate here.

/** Loosely-typed raw MESSAGE_CREATE payload (gateway shape). */
export interface RawInboundMessage {
  id: string
  channel_id: string
  guild_id?: string
  content?: string
  author?: { id?: string; username?: string; bot?: boolean }
  mentions?: Array<{ id?: string }>
  attachments?: Array<{ id?: string; filename?: string; url?: string; content_type?: string; size?: number }>
}

export interface InboundSurfaceDeps {
  botUserId(): string | null
  /** Live settings view — enabled/allowlist edits apply without restart. */
  settings(): Pick<DiscordIntegrationSettings, 'enabled' | 'inbound'>
  /** Fetch an attachment URL to bytes — injectable for tests. */
  download(url: string): Promise<Buffer>
  /** Ephemeral interaction reply — slash-command acks/denials. */
  replyEphemeral?(interactionId: string, token: string, content: string): Promise<void>
  /** Where temp attachment files land (defaults to the OS tmpdir). */
  tmpDir?: string
}

/** Raw APPLICATION_COMMAND interaction payload (type 2). */
export interface RawCommandInteraction {
  id: string
  token: string
  type: number
  data?: { name?: string }
  channel_id?: string
  guild_id?: string
  member?: { user?: { id?: string; username?: string } }
  user?: { id?: string; username?: string }
}

/** The one slash command the bridge registers per configured guild. */
export const NEW_CHAT_COMMAND = 'new-chat'

export interface InboundSurface {
  subscribe(handler: (message: InboundChannelMessage) => void): () => void
  handleMessage(raw: RawInboundMessage): Promise<void>
  handleCommandInteraction(raw: RawCommandInteraction): Promise<void>
}

function stripBotMention(text: string, botId: string): string {
  // Discord renders mentions as <@id> or <@!id> (legacy nickname form).
  return text.replaceAll(`<@${botId}>`, '').replaceAll(`<@!${botId}>`, '').trim()
}

export function createInboundSurface(deps: InboundSurfaceDeps): InboundSurface {
  const handlers = new Set<(message: InboundChannelMessage) => void>()

  async function materializeAttachments(raw: RawInboundMessage): Promise<{ attachments: InboundChannelAttachment[]; skipped: string[] }> {
    const results: InboundChannelAttachment[] = []
    const skipped: string[] = []
    for (const attachment of raw.attachments ?? []) {
      const { filename, url, content_type: contentType, size } = attachment
      if (!filename || !url) continue
      if (typeof size === 'number' && size > INBOUND_ATTACHMENT_MAX_BYTES) {
        log.warn('Inbound attachment exceeds size cap — skipped', { filename, size })
        skipped.push(`[attachment ${filename} skipped — larger than ${INBOUND_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB]`)
        continue
      }
      try {
        const data = await deps.download(url)
        const dir = join(deps.tmpDir ?? tmpdir(), 'bakin-discord-inbound')
        mkdirSync(dir, { recursive: true })
        const path = join(dir, `${randomUUID()}-${filename.replaceAll('/', '_')}`)
        writeFileSync(path, data)
        results.push({ name: filename, path, ...(contentType ? { contentType } : {}), ...(size !== undefined ? { size } : {}) })
      } catch (err) {
        log.warn('Inbound attachment download failed — message continues text-only', err, { filename })
        skipped.push(`[attachment ${filename} could not be fetched]`)
      }
    }
    return { attachments: results, skipped }
  }

  return {
    subscribe(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },

    async handleCommandInteraction(raw) {
      if (raw.type !== 2) return
      if (raw.data?.name !== NEW_CHAT_COMMAND) {
        // A command this bridge doesn't own (e.g. OpenClaw's, registered on
        // the same application, whose daemon is stopped). Silence renders
        // as Discord's "application did not respond" — answer honestly.
        await deps.replyEphemeral?.(raw.id, raw.token,
          `This command isn't served while Bakin's delivery bridge owns the bot. Bakin's command here is /${NEW_CHAT_COMMAND}.`)
        return
      }
      const settings = deps.settings()
      const user = raw.member?.user ?? raw.user
      const channelRef = discordChannelRef(raw.channel_id ?? '')
      if (!settings.enabled || !settings.inbound.enabled) return
      if (!user?.id || !settings.inbound.allowFrom.includes(user.id)) {
        auditDelivery('delivery.inbound_denied', { actor: user?.id ?? 'unknown', channel: channelRef, command: NEW_CHAT_COMMAND })
        await deps.replyEphemeral?.(raw.id, raw.token, 'You are not authorized to manage this chat.')
        return
      }
      await deps.replyEphemeral?.(raw.id, raw.token, '✨ Fresh chat — the next message here starts a new conversation (the old one stays in Bakin).')
      const message: InboundChannelMessage = {
        platform: 'discord',
        channelRef,
        authorId: user.id,
        ...(user.username ? { authorName: user.username } : {}),
        text: '',
        messageRef: `interaction:${raw.id}`,
        command: { name: NEW_CHAT_COMMAND },
      }
      for (const handler of handlers) {
        try {
          handler(message)
        } catch (err) {
          log.error('Inbound command handler failed', err, { channel: channelRef })
        }
      }
    },

    async handleMessage(raw) {
      const settings = deps.settings()
      if (!settings.enabled || !settings.inbound.enabled) return

      const author = raw.author
      if (!author?.id || author.bot || author.id === deps.botUserId()) return

      const isGuildMessage = Boolean(raw.guild_id)
      const botId = deps.botUserId()
      if (isGuildMessage && settings.inbound.requireMention) {
        const mentioned = botId !== null && (raw.mentions ?? []).some(mention => mention.id === botId)
        if (!mentioned) return // not addressed to the bot — not a denial
      }

      const channelRef = discordChannelRef(raw.channel_id)
      if (!settings.inbound.allowFrom.includes(author.id)) {
        auditDelivery('delivery.inbound_denied', { actor: author.id, channel: channelRef })
        return
      }

      const rawText = botId ? stripBotMention(raw.content ?? '', botId) : (raw.content ?? '').trim()
      const { attachments, skipped } = await materializeAttachments(raw)
      // Skipped attachments surface IN the message — the agent (and the
      // sender, via the reply) sees WHY an image is missing, never silence.
      const text = [rawText, ...skipped].filter(Boolean).join('\n\n')
      if (!text && attachments.length === 0) return

      const message: InboundChannelMessage = {
        platform: 'discord',
        channelRef,
        authorId: author.id,
        ...(author.username ? { authorName: author.username } : {}),
        text,
        ...(attachments.length ? { attachments } : {}),
        messageRef: `message:${raw.id}`,
      }
      for (const handler of handlers) {
        try {
          handler(message)
        } catch (err) {
          log.error('Inbound message handler failed', err, { channel: channelRef })
        }
      }
    },
  }
}
