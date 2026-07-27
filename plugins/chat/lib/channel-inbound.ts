/**
 * Inbound channel messages → real Bakin chats (#669 Phase B, D7).
 *
 * Mirrors workflows' wireChannelApprovals: feature-detect the optional
 * runtime surface at activate, return an unsubscribe for onShutdown. The
 * bridge has ALREADY gated the sender (allowlists fail closed, mention
 * rules) — this module only routes:
 *
 *   inbound message → find-or-create the chat bound to the channel
 *   (ChatSummary.externalKey) → run the turn through the ONE conversation
 *   turn engine (work class `chat`, queue-when-busy) → on `chat.done`, post
 *   the reply back through runtime.channels.sendMessage. A typing pulse
 *   repeats while the turn runs (sendTyping is optional — feature-detected).
 *
 * The same chat is usable from the web UI interchangeably: replies to a
 * BOUND chat post back to its channel regardless of where the user message
 * came from — that is the point, not a bug.
 */
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { join, basename } from 'path'
import type { PluginContext } from '@bakin/core/plugin-types'
import type { InboundChannelMessage } from '@bakin/core/adapters/runtime'
import { createLogger } from '../../../src/core/logger'
import { getSettings } from '../../../src/core/settings'
import type { ChatAttachment, ChatTranscriptRow } from '../types'
import { attachmentsDir, clearExternalKey, createChat, findChatByExternalKey, getChatSummary, readTranscript } from './store'
import { startChatTurn } from './stream-bridge'

const log = createLogger('chat-channel-inbound')

/**
 * RASTER types ride the model's image-input lane. `image/*` is NOT enough:
 * Discord reports SVGs as image/svg+xml, small files skip downscaling, and
 * an svg+xml data URL is rejected by model providers — worse, the poisoned
 * item stays in the chat session and fails EVERY later turn
 * (live-validation finding, 2026-07-26). Everything non-raster lands as a
 * FILE in the chat's attachment dir with its path in the message — the
 * agent reads it with its file tools.
 */
const RASTER_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** Magic-byte check for the four raster types the image lane accepts. */
export function sniffIsRaster(path: string): boolean {
  try {
    const fd = openSync(path, 'r')
    const head = Buffer.alloc(12)
    readSync(fd, head, 0, 12, 0)
    closeSync(fd)
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return true // PNG
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return true // JPEG
    if (head.toString('latin1', 0, 4) === 'GIF8') return true // GIF
    if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return true // WebP
    return false
  } catch {
    return false
  }
}

/** Discord's typing state expires after ~10s — pulse well inside that. */
const TYPING_PULSE_MS = 8_000

type WireContext = Pick<PluginContext, 'runtime' | 'events'>

function inboundAgentId(): string {
  return getSettings().integrations.discord.inbound.agentId || 'main'
}

/** Assistant text of the just-finished turn: rows after the last user row. */
export function extractReplyText(rows: ChatTranscriptRow[]): string {
  let lastUser = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].kind === 'user') { lastUser = i; break }
  }
  return rows
    .slice(lastUser + 1)
    .filter((row): row is Extract<ChatTranscriptRow, { kind: 'assistant' }> => row.kind === 'assistant')
    .map(row => row.content)
    .join('\n\n')
    .trim()
}

export function wireChannelInbound(ctx: WireContext): () => void {
  const channels = ctx.runtime.channels
  if (!channels?.subscribeInboundMessages) {
    log.info('Runtime has no inbound channel stream — inbound chat inactive')
    return () => {}
  }
  const subscribeInbound = channels.subscribeInboundMessages.bind(channels)

  // ── typing pulse per chat ────────────────────────────────────────────
  const typingTimers = new Map<string, ReturnType<typeof setInterval>>()
  function startTyping(chatId: string, channelRef: string): void {
    if (!channels?.sendTyping || typingTimers.has(chatId)) return
    const sendTyping = channels.sendTyping.bind(channels)
    const pulse = (): void => {
      void sendTyping({ channel: channelRef }).catch(() => {
        // Best-effort by design — a lost pulse is invisible.
      })
    }
    pulse()
    typingTimers.set(chatId, setInterval(pulse, TYPING_PULSE_MS))
  }
  function stopTyping(chatId: string): void {
    const timer = typingTimers.get(chatId)
    if (timer) {
      clearInterval(timer)
      typingTimers.delete(chatId)
    }
  }

  async function channelLabel(channelRef: string): Promise<string | null> {
    try {
      const listed = await channels?.list() ?? []
      return listed.find(channel => channel.id === channelRef)?.label ?? null
    } catch {
      return null
    }
  }

  // One creation per channel at a time: a burst of first-contact messages
  // would otherwise race past findChatByExternalKey (channelLabel suspends)
  // and bind TWO chats to one channel (review finding).
  const chatCreations = new Map<string, Promise<{ id: string; agentId: string }>>()

  function findOrCreateChat(message: InboundChannelMessage): Promise<{ id: string; agentId: string }> {
    const existing = findChatByExternalKey(message.channelRef)
    if (existing) return Promise.resolve(existing)
    let pending = chatCreations.get(message.channelRef)
    if (!pending) {
      pending = (async () => {
        // Deterministic zero-cost title from the channel label (guild
        // channels) or the sender (DMs — not enumerable via list()).
        const label = await channelLabel(message.channelRef)
        const rebound = findChatByExternalKey(message.channelRef)
        if (rebound) return rebound
        const title = label
          ? `${label} · Discord`
          : `DM · ${message.authorName ?? message.authorId} · Discord`
        const created = await createChat({ agentId: inboundAgentId(), title, externalKey: message.channelRef })
        log.info('Bound new chat to channel', { chatId: created.id, channel: message.channelRef })
        return created
      })().finally(() => chatCreations.delete(message.channelRef))
      chatCreations.set(message.channelRef, pending)
    }
    return pending
  }

  /**
   * Copy bridge temp files into the chat's own attachment dir (the engine
   * downscales; the GET route serves only from this dir), gated on the
   * agent's image-input capability — an unsupported attachment degrades to
   * a visible note, never a dropped message.
   */
  async function adoptAttachments(
    chatId: string,
    agentId: string,
    message: InboundChannelMessage,
  ): Promise<{ attachments: ChatAttachment[]; notes: string[] }> {
    const incoming = message.attachments ?? []
    if (incoming.length === 0) return { attachments: [], notes: [] }
    let imageInput = false
    try {
      imageInput = (await ctx.runtime.capabilities({ agentId })).input.imageInput === true
    } catch {
      imageInput = false // conservative — same as the composer probe
    }
    const dir = attachmentsDir(chatId)
    mkdirSync(dir, { recursive: true })
    const attachments: ChatAttachment[] = []
    const notes: string[] = []
    for (const file of incoming) {
      try {
        // Sanitize (same class as the web upload route) THEN uniquify on
        // collision: Discord clipboard pastes are all named image.png — an
        // overwrite would silently swap the image under EARLIER transcript
        // rows (they are path-addressed by name).
        let name = basename(file.name).replace(/[^\w.\- ]/g, '_')
        if (!name.replace(/[._\- ]/g, '')) name = `file-${randomUUID().slice(0, 8)}`
        if (existsSync(join(dir, name))) name = `${randomUUID().slice(0, 8)}-${name}`
        const target = join(dir, name)
        copyFileSync(file.path, target)
        rmSync(file.path, { force: true })
        // Trust bytes, not the Discord-supplied content_type: a renamed
        // non-image labeled image/png would enter the model lane unvalidated
        // and poison the session (the exact class the SVG fix targeted).
        const isRasterImage = Boolean(file.contentType && RASTER_IMAGE_TYPES.has(file.contentType))
          && sniffIsRaster(target)
        if (isRasterImage && imageInput) {
          attachments.push({ name, mimeType: file.contentType!, path: target })
        } else if (isRasterImage) {
          notes.push(`[image ${name} saved at ${target} — the agent's model has no image input; it can still read the file with its tools]`)
        } else {
          // Non-raster (SVG, PDF, CSV, …): the file lane — never the image
          // lane (an svg+xml data URL poisons the whole session).
          notes.push(`[file ${name} from Discord saved at ${target} — open it with your file tools]`)
        }
      } catch (err) {
        log.warn('Inbound attachment adoption failed — noted, not fatal', err, { name: file.name })
        notes.push(`[attachment ${file.name} could not be processed]`)
      }
    }
    return { attachments, notes }
  }

  const unsubscribeInbound = subscribeInbound((message) => {
    void (async () => {
      if (message.command) {
        // /new-chat: unbind — the next message starts a fresh chat (and a
        // fresh runtime session). The old chat keeps its history in the UI.
        if (message.command.name === 'new-chat') {
          const bound = findChatByExternalKey(message.channelRef)
          if (bound) {
            stopTyping(bound.id)
            await clearExternalKey(bound.id)
            log.info('Channel unbound by /new-chat', { chatId: bound.id, channel: message.channelRef })
          }
        }
        return
      }
      const chat = await findOrCreateChat(message)
      const { attachments, notes } = await adoptAttachments(chat.id, chat.agentId, message)
      const content = [message.text, ...notes].filter(Boolean).join('\n\n')
      if (!content && attachments.length === 0) return
      // Typing starts on chat.started (event-driven below) — drained queued
      // turns pulse too, and a failed start can never leak a timer.
      const result = await startChatTurn(ctx as Parameters<typeof startChatTurn>[0], chat.id, content || '(image)', attachments, { queueIfBusy: true })
      if (result === 'not_found' || result === 'busy') {
        log.warn('Inbound turn not accepted', { chatId: chat.id, result })
      }
    })().catch((err) => {
      log.error('Inbound channel message handling failed', err, { channel: message.channelRef })
    })
  })

  // Typing rides the ENGINE lifecycle, not inbound arrival: chat.started
  // fires for every turn on the chat — including drained queued turns —
  // and a turn that never starts never starts a timer (review finding).
  const unsubscribeStarted = ctx.events.on('chat.started', (_event: string, payload: Record<string, unknown>) => {
    const chatId = typeof payload.chatId === 'string' ? payload.chatId : null
    if (!chatId) return
    const summary = getChatSummary(chatId)
    if (summary?.externalKey) startTyping(chatId, summary.externalKey)
  })

  // Reply relay: ANY settled turn on a bound chat posts back to its channel
  // — web-originated messages included (interchangeable conversation, D7).
  const unsubscribeDone = ctx.events.on('chat.done', (_event: string, payload: Record<string, unknown>) => {
    void (async () => {
      const chatId = typeof payload.chatId === 'string' ? payload.chatId : null
      if (!chatId) return
      stopTyping(chatId)
      if (payload.aborted === true) return
      const summary = getChatSummary(chatId)
      if (!summary?.externalKey || !channels) return
      const reply = extractReplyText(readTranscript(chatId))
      if (!reply) return
      await channels.sendMessage({ channels: [summary.externalKey], message: { body: reply } })
    })().catch((err) => {
      log.error('Posting chat reply to channel failed', err)
    })
  })

  const unsubscribeError = ctx.events.on('chat.error', (_event: string, payload: Record<string, unknown>) => {
    void (async () => {
      const chatId = typeof payload.chatId === 'string' ? payload.chatId : null
      if (!chatId) return
      stopTyping(chatId)
      const summary = getChatSummary(chatId)
      if (!summary?.externalKey || !channels) return
      const message = typeof payload.message === 'string' ? payload.message : 'unknown error'
      // Honest failure — a Discord-side sender must never wait on silence.
      await channels.sendMessage({
        channels: [summary.externalKey],
        message: { body: `⚠️ The agent turn failed: ${message}` },
      })
    })().catch((err) => {
      log.error('Posting chat error to channel failed', err)
    })
  })

  return () => {
    unsubscribeInbound()
    unsubscribeStarted()
    unsubscribeDone()
    unsubscribeError()
    for (const timer of typingTimers.values()) clearInterval(timer)
    typingTimers.clear()
  }
}
