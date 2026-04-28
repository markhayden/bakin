/**
 * bakin_exec_post_channel
 */
import { z } from 'zod'
import { existsSync } from 'fs'
import { basename, join } from 'path'
import { getContentDir } from '@/core/content-dir'
import { getRuntimeAdapter } from '@/core/runtime-registry'
import { pathForFilename } from '@bakin/assets/lib/path-for-filename'
import { succeed, fail } from './common'
import { addExecTool } from './registry'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import type { ExecToolResult } from '@bakin/core/plugin-types'

export interface PostChannelParams {
  channel: string
  content: string
  agent: string
  imageFilename?: string
  videoFilename?: string
  embed?: Record<string, unknown>
  taskId?: string
}

/**
 * Derive an absolute file path from a canonical asset filename. Returns null
 * when the filename is non-canonical or missing from disk.
 */
function resolveAssetAbsPath(filename: string | undefined): string | null {
  if (!filename) return null
  const rel = pathForFilename(filename)
  if (!rel) return null
  const abs = join(getContentDir(), rel)
  return existsSync(abs) ? abs : null
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
  runtime: AgentRuntimeAdapter = getRuntimeAdapter(),
): Promise<ExecToolResult> {
  const requestedChannel = params.channel
  const channel = normalizeChannelTarget(isTestMode() ? TEST_CHANNEL : requestedChannel)
  const { content, imageFilename, videoFilename, embed, taskId } = params

  const files = [
    filePayload(imageFilename, resolveAssetAbsPath(imageFilename)),
    filePayload(videoFilename, resolveAssetAbsPath(videoFilename)),
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

function filePayload(filename: string | undefined, path: string | null): { name: string; path: string } | null {
  if (!filename || !path) return null
  return { name: basename(filename), path }
}

addExecTool({
  name: 'bakin_exec_post_channel',
  label: 'Posted to channel',
  description: 'Post a message through the active runtime channel adapter. Supports image/video attachments when the adapter supports rich content.',
  source: 'core',
  parameters: {
    channel: z.string().describe('Channel name or runtime channel target'),
    content: z.string().describe('Message text / caption'),
    imageFilename: z.string().optional().describe('Asset filename resolved via the assets index.'),
    videoFilename: z.string().optional().describe('Asset filename resolved via the assets index.'),
    embed: z.record(z.string(), z.unknown()).optional().describe('Optional rich metadata for adapters that support it'),
    taskId: z.string().optional().describe('Task ID for audit trail'),
  },
  handler: async (params: Record<string, unknown>, agent: string, ctx) => {
    return postChannel({ ...params, agent } as PostChannelParams, ctx?.runtime)
  },
})
