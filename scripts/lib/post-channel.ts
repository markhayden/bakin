/**
 * bakin_exec_post_channel
 */
import { z } from 'zod'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { basename, extname } from 'path'
import { getAppServices } from '@/core/app-services'
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

  const signature = postSignature({ ...params, channel, files })
  const existing = postInflight.get(signature)
  if (existing) return existing
  const cached = postCompleted.get(signature)
  if (cached) {
    if (cached.expiresAt > Date.now()) return { ...cached.result, deduped: true }
    postCompleted.delete(signature)
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
  },
  handler: async (params: Record<string, unknown>, agent: string, ctx) => {
    return postChannel({ ...params, agent } as PostChannelParams, ctx?.runtime)
  },
})
