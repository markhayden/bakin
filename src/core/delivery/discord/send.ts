/**
 * Discord send surface (A4): messages, severity-embed notifications, content
 * delivery with attachments (path files + { kind: 'asset' } refs via the
 * assets.resolveServe hook), threads, edits. 2000-char chunking, DM targets
 * (D3), bounded retry with backoff → delivery.send_failed audit (D13), and
 * optional metadata.idempotencyKey dedupe through the execution ledger so
 * retry-prone callers can never double-post across restarts.
 */
import { readFileSync } from 'fs'
import type {
  ChannelMessageArgs,
  ContentDeliveryArgs,
  CreatedThread,
  CreateThreadArgs,
  DeliveryResult,
  EditChannelMessageArgs,
  NotificationArgs,
  RuntimeMetadata,
} from '@bakin/core/adapters/runtime'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { createLogger } from '@/core/logger'
import { getIdempotent, putIdempotent } from '@/core/execution-ledger'
import { auditDelivery } from '../audit'
import { parseDiscordRef, discordChannelRef } from './refs'

const log = createLogger('delivery-send')

export const DISCORD_MESSAGE_LIMIT = 2000
export const DISCORD_EMBED_DESCRIPTION_LIMIT = 4096
/** Discord's default per-file bot upload cap. */
export const DISCORD_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024

const SEVERITY_COLORS: Record<NotificationArgs['notification']['severity'], number> = {
  info: 0x3b82f6,
  warn: 0xf59e0b,
  error: 0xef4444,
  success: 0x22c55e,
}

export interface OutgoingFile {
  name: string
  data: Uint8Array
  contentType?: string
}

export interface MessagePayload {
  content?: string
  embeds?: Array<Record<string, unknown>>
  files?: OutgoingFile[]
  /** Interactive component rows (approval cards) — must survive the transport binding. */
  components?: Array<Record<string, unknown>>
}

/** Minimal REST surface the send paths need — injectable for tests. */
export interface SendApi {
  createMessage(channelId: string, payload: MessagePayload): Promise<{ id: string }>
  editMessage(channelId: string, messageId: string, body: string): Promise<void>
  startThread(channelId: string, name: string, messageId?: string): Promise<{ id: string }>
  createDM(userId: string): Promise<{ id: string }>
}

export interface SendSurfaceDeps {
  api: SendApi
  maxUploadBytes?: number
  /** Injectable for tests; production uses a real timer. */
  sleep?: (ms: number) => Promise<void>
}

export interface SendSurface {
  sendMessage(args: ChannelMessageArgs): Promise<DeliveryResult>
  sendNotification(args: NotificationArgs): Promise<DeliveryResult>
  deliverContent(args: ContentDeliveryArgs): Promise<DeliveryResult>
  createThread(args: CreateThreadArgs): Promise<CreatedThread | null>
  editMessage(args: EditChannelMessageArgs): Promise<void>
}

export function chunkDiscordText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    const cut = window.lastIndexOf('\n')
    const split = cut > 0 ? cut : limit
    chunks.push(rest.slice(0, split))
    rest = rest.slice(split === cut ? split + 1 : split)
  }
  if (rest.length > 0) chunks.push(rest)
  return chunks
}

const RETRY_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 500

function metadataIdempotencyKey(metadata: RuntimeMetadata | undefined): string | null {
  const value = metadata?.idempotencyKey
  return typeof value === 'string' && value.length > 0 ? value : null
}

interface ResolvedServeFile {
  path: string
  contentType?: string
}

export function createSendSurface(deps: SendSurfaceDeps): SendSurface {
  const maxUploadBytes = deps.maxUploadBytes ?? DISCORD_UPLOAD_LIMIT_BYTES
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))

  async function withRetry<T>(label: string, channel: string, fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastErr = err
        if (attempt < RETRY_ATTEMPTS) {
          log.warn(`Discord ${label} failed (attempt ${attempt}/${RETRY_ATTEMPTS}) — retrying`, err, { channel })
          await sleep(RETRY_BASE_DELAY_MS * attempt)
        }
      }
    }
    auditDelivery('delivery.send_failed', {
      surface: label,
      channel,
      attempts: RETRY_ATTEMPTS,
      error: lastErr instanceof Error ? lastErr.message : String(lastErr),
    })
    log.error(`Discord ${label} failed after ${RETRY_ATTEMPTS} attempts`, lastErr, { channel })
    throw lastErr
  }

  /** Resolve a neutral channel ref to a postable Discord channel id. */
  async function resolveChannelId(ref: string): Promise<string> {
    const parsed = parseDiscordRef(ref)
    if (parsed.kind === 'user') {
      const dm = await deps.api.createDM(parsed.id)
      return dm.id
    }
    return parsed.id
  }

  /**
   * Post payload to one neutral channel ref, chunking content. The FIRST
   * message carries embeds/files and anchors the delivery ref (threads and
   * edits target it).
   */
  async function postToChannel(
    surface: string,
    channelRef: string,
    content: string,
    extras: Omit<MessagePayload, 'content'> = {},
  ): Promise<DeliveryResult['deliveries'][number]> {
    const channelId = await resolveChannelId(channelRef)
    const chunks = content.length > 0 ? chunkDiscordText(content, DISCORD_MESSAGE_LIMIT) : ['']
    let firstId: string | null = null
    for (let i = 0; i < chunks.length; i++) {
      const payload: MessagePayload = i === 0
        ? { ...(chunks[i] ? { content: chunks[i] } : {}), ...extras }
        : { content: chunks[i] }
      const message = await withRetry(surface, channelRef, () => deps.api.createMessage(channelId, payload))
      if (firstId === null) firstId = message.id
    }
    const delivery = { channelId: channelRef, ref: `message:${firstId}`, renderedAt: new Date().toISOString() }
    auditDelivery('delivery.sent', { surface, channel: channelRef, ref: delivery.ref, chunks: chunks.length })
    return delivery
  }

  async function withIdempotency(
    metadata: RuntimeMetadata | undefined,
    surface: string,
    run: () => Promise<DeliveryResult>,
  ): Promise<DeliveryResult> {
    const key = metadataIdempotencyKey(metadata)
    if (!key) return run()
    const ledgerKey = `delivery:${surface}:${key}`
    const existing = getIdempotent(ledgerKey)
    if (existing) {
      log.info('Duplicate delivery suppressed by idempotency key', { surface, key })
      return existing.result as DeliveryResult
    }
    const result = await run()
    putIdempotent(ledgerKey, 'delivery', result)
    return result
  }

  async function resolveFiles(
    files: NonNullable<ContentDeliveryArgs['content']['files']>,
  ): Promise<{ outgoing: OutgoingFile[]; omitted: string[] }> {
    const outgoing: OutgoingFile[] = []
    const omitted: string[] = []
    for (const file of files) {
      let name: string
      let path: string
      let contentType: string | undefined
      if ('kind' in file) {
        name = file.filename
        contentType = file.mimeType
        const resolved = await getHookRegistry().invoke<ResolvedServeFile>('assets.resolveServe', { segments: [file.filename] })
        if (!resolved?.path) {
          omitted.push(`${name} (asset could not be resolved)`)
          continue
        }
        path = resolved.path
        contentType = contentType ?? resolved.contentType
      } else {
        name = file.name
        path = file.path
        contentType = file.contentType
      }
      const data = readFileSync(path)
      if (data.byteLength > maxUploadBytes) {
        const mb = (data.byteLength / (1024 * 1024)).toFixed(1)
        omitted.push(`${name} (${mb} MB — too large to attach; stored in Bakin)`)
        continue
      }
      outgoing.push({ name, data, ...(contentType ? { contentType } : {}) })
    }
    return { outgoing, omitted }
  }

  return {
    sendMessage: (args) => withIdempotency(args.message.metadata, 'message', async () => {
      const content = [args.message.title, args.message.body].filter(Boolean).join('\n\n')
      const deliveries = []
      for (const channel of args.channels) {
        deliveries.push(await postToChannel('message', channel, content))
      }
      return { deliveries }
    }),

    sendNotification: (args) => withIdempotency(args.notification.metadata, 'notification', async () => {
      const { severity, title, body, fields } = args.notification
      const description = body.length > DISCORD_EMBED_DESCRIPTION_LIMIT
        ? `${body.slice(0, DISCORD_EMBED_DESCRIPTION_LIMIT - 1)}…`
        : body
      const embed: Record<string, unknown> = {
        title,
        description,
        color: SEVERITY_COLORS[severity],
        ...(fields?.length
          ? { fields: fields.map(field => ({ name: field.label, value: field.value, inline: true })) }
          : {}),
      }
      const deliveries = []
      for (const channel of args.channels) {
        deliveries.push(await postToChannel('notification', channel, '', { embeds: [embed] }))
      }
      return { deliveries }
    }),

    deliverContent: (args) => withIdempotency(args.content.metadata, 'content', async () => {
      const { outgoing, omitted } = args.content.files?.length
        ? await resolveFiles(args.content.files)
        : { outgoing: [], omitted: [] }
      const contentParts = [
        [args.content.title, args.content.body].filter(Boolean).join('\n\n'),
        args.content.url,
        ...omitted.map(entry => `📎 ${entry}`),
      ].filter(Boolean)
      const deliveries = []
      for (const channel of args.channels) {
        deliveries.push(await postToChannel('content', channel, contentParts.join('\n\n'), outgoing.length ? { files: outgoing } : {}))
      }
      return { deliveries }
    }),

    createThread: async (args) => {
      const parsed = parseDiscordRef(args.channel)
      if (parsed.kind !== 'channel') return null
      const messageId = args.messageRef?.startsWith('message:') ? args.messageRef.slice('message:'.length) : undefined
      const thread = await withRetry('thread', args.channel, () => deps.api.startThread(parsed.id, args.name, messageId))
      return { threadId: thread.id, channelRef: discordChannelRef(thread.id) }
    },

    editMessage: async (args) => {
      const parsed = parseDiscordRef(args.channel)
      const messageId = args.messageRef.startsWith('message:') ? args.messageRef.slice('message:'.length) : args.messageRef
      await withRetry('edit', args.channel, () => deps.api.editMessage(parsed.id, messageId, args.body))
    },
  }
}
