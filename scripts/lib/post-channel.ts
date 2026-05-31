/**
 * bakin_exec_post_channel
 */
import { z } from 'zod'
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

  try {
    const result = await runtime.channels.deliverContent({
      channels: [channel],
      content: {
        title: 'Channel post',
        body: content,
        files,
        metadata: {
          agent: params.agent,
          taskId,
          embed,
          requestedChannel,
          resolvedChannel: channel,
          ...(isTestMode() && channel !== normalizeChannelTarget(requestedChannel) ? { testMode: true } : {}),
        },
      },
    })

    return succeed({
      deliveries: result.deliveries,
      channel: displayChannel(channel),
      taskId,
      ...(isTestMode() && channel !== normalizeChannelTarget(requestedChannel) ? {
        testMode: true,
        requestedChannel: displayChannel(normalizeChannelTarget(requestedChannel)),
      } : {}),
    })
  } catch (err) {
    return fail(`Runtime channel delivery failed: ${err instanceof Error ? err.message : String(err)}`)
  }
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
