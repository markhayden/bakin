/**
 * bakin_exec_post_channel
 */
import { z } from 'zod'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { basename, extname } from 'path'
import { getAppServices } from '@/core/app-services'
import { getIdempotent, putIdempotent, LedgerUnavailableError } from '@/core/execution-ledger'
import { createLogger } from '@/core/logger'
import { resolveRuntimeChannelRef } from '@/core/channel-aliases'
import { assertWorkflowToolAllowed } from '@/core/workflow-tool-authorization'
import { resolveFile } from '@bakin/assets/lib/asset-service'
import { succeed, fail } from './common'
import { addExecTool } from './registry'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import type { ExecToolResult } from '@bakin/core/plugin-types'

export interface PostChannelParams {
  channel: string
  content: string
  agent: string
  imageAssetId?: string
  videoAssetId?: string
  embed?: Record<string, unknown>
  taskId?: string
  /** Explicit intent to send a second copy of an already-delivered asset. */
  repost?: boolean
}

/**
 * Resolve an assetId to its current-version file on disk. Returns null when the
 * asset is unknown or its file is missing.
 */
function resolveAssetAbsPath(assetId: string | undefined): string | null {
  if (!assetId) return null
  const ref = resolveFile(assetId)
  return ref && existsSync(ref.absPath) ? ref.absPath : null
}

// When BAKIN_CHANNEL_TEST_MODE=1 (or "true"), all posts are routed to
// the testing-ground channel regardless of what the caller requested.
const log = createLogger('post-channel')
const TEST_CHANNEL = 'testing-ground'
const POST_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000
export const CHANNEL_POST_CHUNK_LIMIT = 1900
const postInflight = new Map<string, Promise<ExecToolResult>>()
const postCompleted = new Map<string, { result: ExecToolResult; expiresAt: number }>()

function isTestMode(): boolean {
  const val = process.env.BAKIN_CHANNEL_TEST_MODE
  return val === '1' || val === 'true'
}

export async function postChannel(
  params: PostChannelParams,
  runtime: AgentRuntimeAdapter = getAppServices().runtime,
): Promise<ExecToolResult> {
  try {
    await assertWorkflowToolAllowed({ taskId: params.taskId, agent: params.agent, action: 'channel-post' })
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }

  const requestedChannel = params.channel
  let channel: string
  try {
    channel = (await resolveRuntimeChannelRef(
      runtime,
      normalizeChannelTarget(isTestMode() ? TEST_CHANNEL : requestedChannel),
    )).resolved
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
  const { content, imageAssetId, videoAssetId, embed, taskId } = params

  const files = [
    filePayload(imageAssetId, resolveAssetAbsPath(imageAssetId)),
    filePayload(videoAssetId, resolveAssetAbsPath(videoAssetId)),
  ].filter((file): file is { name: string; path: string } => Boolean(file))

  // Identical-retry dedup runs FIRST: a verbatim retry of a post we already
  // sent (mcporter timeout — the caller never saw the success) must return
  // the cached result, never a refusal whose error text invites repost=true.
  const signature = postSignature({ ...params, channel, files })
  const existing = postInflight.get(signature)
  if (existing) return existing
  const cached = postCompleted.get(signature)
  if (cached) {
    if (cached.expiresAt > Date.now()) return { ...cached.result, deduped: true }
    postCompleted.delete(signature)
  }

  // A deliverable goes to a channel ONCE per task (live-test incident: the
  // same asset posted twice with DIFFERENT captions — monitor post + completion
  // reply, which the signature cache above cannot catch). Durable in the
  // ledger so it survives restarts; the asset IS the deliverable. repost=true
  // is the explicit escape hatch; only successful deliveries record a row.
  // Best-effort against concurrent different-caption posts (check-then-act);
  // the observed incident was sequential.
  const deliveredAssetIds = [imageAssetId, videoAssetId].filter((id): id is string => Boolean(id))
  const deliveryKeys = taskId
    ? deliveredAssetIds.map(assetId => `channel-post:${taskId}:${channel}:${assetId}`)
    : []
  if (!params.repost) {
    for (const key of deliveryKeys) {
      let prior
      try {
        prior = getIdempotent(key)
      } catch (err) {
        // Fail closed with an explanation: without the ledger we cannot rule
        // out a prior delivery, and external sends are non-idempotent.
        if (err instanceof LedgerUnavailableError) {
          return fail(`Cannot verify whether this asset was already delivered (execution ledger unavailable) — refusing to risk a duplicate post. Retry once the ledger is healthy.`)
        }
        throw err
      }
      if (prior) {
        const at = (prior.result as { at?: string } | null)?.at
        return fail(
          `Asset already delivered to ${displayChannel(channel)} for task ${taskId}${at ? ` at ${at}` : ''}. A deliverable goes out once — if a second copy is genuinely intended, pass repost=true.`,
        )
      }
    }
  }

  const promise = deliverChannelPost(runtime, {
    agent: params.agent,
    channel,
    content,
    embed,
    files,
    requestedChannel,
    taskId,
  })
  postInflight.set(signature, promise)
  try {
    const result = await promise
    // External sends are non-idempotent. Cache success and failure briefly so
    // an agent retry caused by a client timeout or ambiguous adapter failure
    // does not emit a second copy of the same message.
    postCompleted.set(signature, { result, expiresAt: Date.now() + POST_IDEMPOTENCY_TTL_MS })
    if (result.ok) {
      for (const key of deliveryKeys) {
        try {
          putIdempotent(key, 'channel.post', { at: new Date().toISOString() })
        } catch (err) {
          // The message already went out — failing the call now would read as
          // "post failed" and provoke a retry. Log; the TTL cache still
          // covers verbatim retries for the next few minutes.
          log.warn('Failed to record channel delivery in the ledger', { key, error: err instanceof Error ? err.message : String(err) })
        }
      }
    }
    return result
  } finally {
    if (postInflight.get(signature) === promise) postInflight.delete(signature)
  }
}

async function deliverChannelPost(
  runtime: AgentRuntimeAdapter,
  input: {
    agent: string
    channel: string
    content: string
    embed?: Record<string, unknown>
    files: Array<{ name: string; path: string }>
    requestedChannel: string
    taskId?: string
  },
): Promise<ExecToolResult> {
  try {
    const chunks = chunkChannelPostContent(input.content)
    const deliveries = []
    for (let i = 0; i < chunks.length; i += 1) {
      const result = await runtime.channels.deliverContent({
        channels: [input.channel],
        content: {
          title: '',
          body: chunks[i],
          files: i === 0 ? input.files : [],
          metadata: {
            agent: input.agent,
            taskId: input.taskId,
            embed: input.embed,
            requestedChannel: input.requestedChannel,
            resolvedChannel: input.channel,
            chunkIndex: i + 1,
            chunkCount: chunks.length,
            ...(isTestMode() && input.channel !== normalizeChannelTarget(input.requestedChannel) ? { testMode: true } : {}),
          },
        },
      })
      deliveries.push(...result.deliveries)
    }

    return succeed({
      deliveries,
      channel: displayChannel(input.channel),
      chunkCount: chunks.length,
      taskId: input.taskId,
      ...(isTestMode() && input.channel !== normalizeChannelTarget(input.requestedChannel) ? {
        testMode: true,
        requestedChannel: displayChannel(normalizeChannelTarget(input.requestedChannel)),
      } : {}),
    })
  } catch (err) {
    return fail(`Runtime channel delivery failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function postSignature(input: PostChannelParams & { channel: string; files: Array<{ name: string; path: string }> }): string {
  const canonical = stableJson({
    agent: input.agent,
    channel: input.channel,
    content: input.content,
    embed: input.embed ?? null,
    files: input.files,
    imageAssetId: input.imageAssetId ?? null,
    repost: input.repost ?? false,
    taskId: input.taskId ?? null,
    testMode: isTestMode(),
    videoAssetId: input.videoAssetId ?? null,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

export function chunkChannelPostContent(content: string, limit = CHANNEL_POST_CHUNK_LIMIT): string[] {
  const normalized = content || ''
  if (normalized.length <= limit) return [normalized]

  const rawChunks = splitTextIntoChunks(normalized, limit - chunkPrefix(99, 99).length)
  const count = rawChunks.length
  const prefixWidth = String(count).length
  const bodyLimit = limit - chunkPrefix(count, count, prefixWidth).length
  const chunks = rawChunks.some(chunk => chunk.length > bodyLimit)
    ? splitTextIntoChunks(normalized, bodyLimit)
    : rawChunks

  return chunks.map((chunk, index) => `${chunkPrefix(index + 1, chunks.length, String(chunks.length).length)}${chunk}`)
}

function chunkPrefix(index: number, count: number, width = String(count).length): string {
  return `[${String(index).padStart(width, '0')}/${count}] `
}

function splitTextIntoChunks(text: string, limit: number): string[] {
  if (limit < 32) throw new Error('Channel post chunk limit is too small')
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > limit) {
    const index = findChunkBreak(remaining, limit)
    chunks.push(remaining.slice(0, index).trimEnd())
    remaining = remaining.slice(index).trimStart()
  }
  chunks.push(remaining)
  return chunks
}

function findChunkBreak(text: string, limit: number): number {
  const search = text.slice(0, limit + 1)
  for (const marker of ['\n\n', '\n', '. ', '; ', ', ', ' ']) {
    const index = search.lastIndexOf(marker)
    if (index >= Math.floor(limit * 0.55)) return index + marker.length
  }
  return limit
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sortJsonValue)
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortJsonValue((value as Record<string, unknown>)[key])
  }
  return out
}

export function resetPostChannelIdempotencyForTests(): void {
  postInflight.clear()
  postCompleted.clear()
}

function normalizeChannelTarget(channel: string): string {
  return channel.replace(/^#/, '')
}

function displayChannel(channel: string): string {
  return channel.includes(':') ? channel : `#${channel}`
}

function filePayload(assetId: string | undefined, path: string | null): { name: string; path: string } | null {
  if (!path) return null
  // Name the attachment by assetId + the version file's extension (e.g.
  // 20260401-hero-a1b2c3d4.png) rather than the on-disk "v1.png".
  const name = assetId ? `${assetId}${extname(path)}` : basename(path)
  return { name, path }
}

addExecTool({
  name: 'bakin_exec_post_channel',
  label: 'Posted to channel',
  description: 'Post a message through the active runtime channel adapter. Supports image/video attachments when the adapter supports rich content.',
  source: 'core',
  parameters: {
    channel: z.string().describe('Channel name or runtime channel target'),
    content: z.string().describe('Message text / caption'),
    imageAssetId: z.string().optional().describe('Asset id of an image to attach (current version is sent).'),
    videoAssetId: z.string().optional().describe('Asset id of a video to attach (current version is sent).'),
    embed: z.record(z.string(), z.unknown()).optional().describe('Optional rich metadata for adapters that support it'),
    taskId: z.string().optional().describe('Task ID for audit trail'),
    repost: z.boolean().optional().describe('An attached asset is delivered to a channel once per task; set true ONLY when a second copy is genuinely intended.'),
  },
  handler: async (params: Record<string, unknown>, agent: string, ctx) => {
    return postChannel({ ...params, agent } as PostChannelParams, ctx?.runtime)
  },
})
