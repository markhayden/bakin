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
  /** Where temp attachment files land (defaults to the OS tmpdir). */
  tmpDir?: string
}

export interface InboundSurface {
  subscribe(handler: (message: InboundChannelMessage) => void): () => void
  handleMessage(raw: RawInboundMessage): Promise<void>
}

function stripBotMention(text: string, botId: string): string {
  // Discord renders mentions as <@id> or <@!id> (legacy nickname form).
  return text.replaceAll(`<@${botId}>`, '').replaceAll(`<@!${botId}>`, '').trim()
}

export function createInboundSurface(deps: InboundSurfaceDeps): InboundSurface {
  const handlers = new Set<(message: InboundChannelMessage) => void>()

  async function materializeAttachments(raw: RawInboundMessage): Promise<InboundChannelAttachment[]> {
    const results: InboundChannelAttachment[] = []
    for (const attachment of raw.attachments ?? []) {
      const { filename, url, content_type: contentType, size } = attachment
      if (!filename || !url) continue
      if (!contentType?.startsWith('image/')) continue
      if (typeof size === 'number' && size > INBOUND_ATTACHMENT_MAX_BYTES) {
        log.warn('Inbound attachment exceeds size cap — skipped', { filename, size })
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
      }
    }
    return results
  }

  return {
    subscribe(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
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

      const text = botId ? stripBotMention(raw.content ?? '', botId) : (raw.content ?? '').trim()
      const attachments = await materializeAttachments(raw)
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
