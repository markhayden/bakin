/**
 * beacon_exec_post_discord — Standardized Discord posting via Main Operator's bot.
 *
 * Resolves channel names to IDs, handles attachments, and formats messages
 * according to channel conventions.
 */
import { z } from 'zod'
import { readFileSync, existsSync } from 'fs'
import { succeed, fail } from './common'
import { addExecTool } from './registry'
import type { ExecToolResult } from '../../src/lib/plugin-types'

// Channel name → ID mapping (loaded from env or settings)
function getChannelMap(): Record<string, string> {
  const mapStr = process.env.BEACON_DISCORD_CHANNELS
  if (mapStr) {
    try {
      return JSON.parse(mapStr)
    } catch {
      // Fall through to defaults
    }
  }
  // Default channel mapping — update with real IDs
  return {
    general: process.env.DISCORD_CHANNEL_GENERAL || '',
    approvals: process.env.DISCORD_CHANNEL_APPROVALS || '',
    content: process.env.DISCORD_CHANNEL_CONTENT || '',
  }
}

function resolveChannelId(channel: string): string | null {
  const map = getChannelMap()
  // Try direct lookup, stripping # prefix
  const name = channel.replace(/^#/, '')
  return map[name] || null
}

export interface PostDiscordParams {
  channel: string
  content: string
  agent: string
  imagePath?: string
  videoPath?: string
  embed?: Record<string, unknown>
  taskId?: string
}

export async function postDiscord(params: PostDiscordParams): Promise<ExecToolResult> {
  const { channel, content, imagePath, videoPath, embed, taskId } = params

  const channelId = resolveChannelId(channel)
  if (!channelId) {
    return fail(`Unknown Discord channel: "${channel}". Available channels: ${Object.keys(getChannelMap()).join(', ')}`)
  }

  const botToken = process.env.DISCORD_BOT_TOKEN
  if (!botToken) {
    return fail('DISCORD_BOT_TOKEN not configured')
  }

  // Build multipart form data for attachments
  const formData = new FormData()

  const payload: Record<string, unknown> = { content }
  if (embed) {
    payload.embeds = [embed]
  }

  formData.append('payload_json', JSON.stringify(payload))

  // Attach files if provided
  let fileIndex = 0
  if (imagePath && existsSync(imagePath)) {
    const data = readFileSync(imagePath)
    const blob = new Blob([data])
    formData.append(`files[${fileIndex}]`, blob, imagePath.split('/').pop() || 'image.png')
    fileIndex++
  }
  if (videoPath && existsSync(videoPath)) {
    const data = readFileSync(videoPath)
    const blob = new Blob([data])
    formData.append(`files[${fileIndex}]`, blob, videoPath.split('/').pop() || 'video.mp4')
  }

  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bot ${botToken}` },
        body: formData,
      },
    )

    if (!response.ok) {
      const error = await response.text()
      return fail(`Discord API error (${response.status}): ${error}`)
    }

    const msg = await response.json() as { id: string; channel_id: string }
    const guildId = process.env.DISCORD_GUILD_ID || ''
    const url = guildId
      ? `https://discord.com/channels/${guildId}/${msg.channel_id}/${msg.id}`
      : undefined

    return succeed({
      messageId: msg.id,
      channel: `#${channel.replace(/^#/, '')}`,
      url,
      taskId,
    })
  } catch (err) {
    return fail(`Discord post failed: ${String(err)}`)
  }
}

addExecTool({
  name: 'beacon_exec_post_discord',
  description: 'Post a message to a Discord channel via bot. Resolves channel names to IDs automatically. Supports image/video attachments and embeds.',
  source: 'core',
  parameters: {
    channel: z.string().describe('Channel name (e.g., "general") — resolved to ID internally'),
    content: z.string().describe('Message text / caption'),
    imagePath: z.string().optional().describe('Absolute path to image file to attach'),
    videoPath: z.string().optional().describe('Absolute path to video file to attach'),
    embed: z.record(z.string(), z.unknown()).optional().describe('Discord embed object (title, description, color, fields)'),
    taskId: z.string().optional().describe('Task ID for audit trail'),
  },
  handler: async (params, agent) => {
    return postDiscord({ ...params, agent } as PostDiscordParams)
  },
})
