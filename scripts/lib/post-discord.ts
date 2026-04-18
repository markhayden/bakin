/**
 * bakin_exec_post_discord — Standardized Discord posting via Roscoe's bot.
 *
 * Auto-discovers channels from the Discord API using bot token and guild ID
 * from openclaw config. Caches the channel map for the process lifetime.
 */
import { z } from 'zod'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getOpenClawPath } from '@bakin/core/openclaw-home'
import { getContentDir } from '@/core/content-dir'
import { resolveFilename } from '@bakin/assets/lib/resolver'
import { succeed, fail } from './common'
import { addExecTool } from './registry'
import type { ExecToolResult } from '../../src/lib/plugin-types'

// ---------------------------------------------------------------------------
// Discord config resolution
// ---------------------------------------------------------------------------

export interface DiscordConfig {
  botToken: string
  guildId: string
}

export function loadDiscordConfig(): DiscordConfig | null {
  // 1. Check env vars first
  if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID) {
    return { botToken: process.env.DISCORD_BOT_TOKEN, guildId: process.env.DISCORD_GUILD_ID }
  }

  // 2. Read from openclaw.json
  try {
    const configPath = getOpenClawPath('openclaw.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    const discord = config.channels?.discord
    if (!discord?.token) return null
    const guildId = discord.guilds ? Object.keys(discord.guilds)[0] : null
    if (!guildId) return null
    return { botToken: discord.token, guildId }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Channel discovery — cached per process
// ---------------------------------------------------------------------------

let channelCache: Record<string, string> | null = null

/** Reset the channel cache — used by tests */
export function _resetChannelCache(): void { channelCache = null }

async function discoverChannels(config: DiscordConfig): Promise<Record<string, string>> {
  if (channelCache) return channelCache

  try {
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${config.guildId}/channels`,
      { headers: { Authorization: `Bot ${config.botToken}` } },
    )
    if (!response.ok) {
      console.error(`Discord channel discovery failed (${response.status}): ${await response.text()}`)
      return {}
    }
    const channels = await response.json() as Array<{ id: string; name: string; type: number }>
    // type 0 = text channel, type 5 = announcement
    const map: Record<string, string> = {}
    for (const ch of channels) {
      if (ch.type === 0 || ch.type === 5) {
        map[ch.name] = ch.id
      }
    }
    channelCache = map
    return map
  } catch (err) {
    console.error('Discord channel discovery error:', err)
    return {}
  }
}

export async function resolveChannelId(channel: string): Promise<{ id: string | null; available: string[] }> {
  const config = loadDiscordConfig()
  if (!config) return { id: null, available: [] }

  const map = await discoverChannels(config)
  const name = channel.replace(/^#/, '')
  return { id: map[name] || null, available: Object.keys(map) }
}

export interface PostDiscordParams {
  channel: string
  content: string
  agent: string
  imageFilename?: string
  videoFilename?: string
  embed?: Record<string, unknown>
  taskId?: string
}

/**
 * Resolve an asset filename to an absolute file path via the filename
 * resolver. Returns null if the filename isn't registered — the caller
 * should skip the attachment rather than fall back to a literal path.
 */
function resolveAssetAbsPath(filename: string | undefined): string | null {
  if (!filename) return null
  const rel = resolveFilename(filename)
  if (!rel) return null
  return join(getContentDir(), rel)
}

// When BAKIN_DISCORD_TEST_MODE=1 (or "true"), all posts are routed to
// the testing-ground channel regardless of what the caller requested.
// Set this in your environment during development to avoid spamming real channels.
const TEST_CHANNEL = 'testing-ground'

function isTestMode(): boolean {
  const val = process.env.BAKIN_DISCORD_TEST_MODE
  return val === '1' || val === 'true'
}

export async function postDiscord(params: PostDiscordParams): Promise<ExecToolResult> {
  const requestedChannel = params.channel
  const channel = isTestMode() ? TEST_CHANNEL : requestedChannel
  const { content, imageFilename, videoFilename, embed, taskId } = params

  const imagePath = resolveAssetAbsPath(imageFilename)
  const videoPath = resolveAssetAbsPath(videoFilename)

  const config = loadDiscordConfig()
  if (!config) {
    return fail('Discord not configured. Set DISCORD_BOT_TOKEN + DISCORD_GUILD_ID env vars, or configure channels.discord in ~/.openclaw/openclaw.json')
  }

  const { id: channelId, available } = await resolveChannelId(channel)
  if (!channelId) {
    return fail(`Unknown Discord channel: "${channel}". Available channels: ${available.join(', ')}`)
  }

  const botToken = config.botToken

  // Build multipart form data for attachments
  const formData = new FormData()

  const payload: Record<string, unknown> = { content }
  if (embed) {
    payload.embeds = [embed]
  }

  formData.append('payload_json', JSON.stringify(payload))

  // Attach files if provided — filename takes precedence; absent or
  // unresolvable filenames simply omit the attachment (no silent path fallback).
  let fileIndex = 0
  if (imagePath && existsSync(imagePath)) {
    const data = readFileSync(imagePath)
    const blob = new Blob([data])
    formData.append(`files[${fileIndex}]`, blob, imageFilename || imagePath.split('/').pop() || 'image.png')
    fileIndex++
  }
  if (videoPath && existsSync(videoPath)) {
    const data = readFileSync(videoPath)
    const blob = new Blob([data])
    formData.append(`files[${fileIndex}]`, blob, videoFilename || videoPath.split('/').pop() || 'video.mp4')
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
    const url = `https://discord.com/channels/${config.guildId}/${msg.channel_id}/${msg.id}`

    const result: Record<string, unknown> = {
      messageId: msg.id,
      channel: `#${channel.replace(/^#/, '')}`,
      url,
      taskId,
    }
    if (isTestMode() && channel !== requestedChannel) {
      result.testMode = true
      result.requestedChannel = `#${requestedChannel.replace(/^#/, '')}`
    }
    return succeed(result)
  } catch (err) {
    return fail(`Discord post failed: ${String(err)}`)
  }
}

addExecTool({
  name: 'bakin_exec_post_discord',
  label: 'Posted to Discord',
  description: 'Post a message to a Discord channel via bot. Resolves channel names to IDs automatically. Supports image/video attachments and embeds.',
  source: 'core',
  parameters: {
    channel: z.string().describe('Channel name (e.g., "general") — resolved to ID internally'),
    content: z.string().describe('Message text / caption'),
    imageFilename: z.string().optional().describe('Asset filename (e.g., "20260401-hero-a1b2c3d4.png") — resolved via the assets index. Globally unique, stable across retype/relink.'),
    videoFilename: z.string().optional().describe('Asset filename (e.g., "20260401-reel-a1b2c3d4.mp4") — resolved via the assets index.'),
    embed: z.record(z.string(), z.unknown()).optional().describe('Discord embed object (title, description, color, fields)'),
    taskId: z.string().optional().describe('Task ID for audit trail'),
  },
  handler: async (params: Record<string, unknown>, agent: string) => {
    return postDiscord({ ...params, agent } as PostDiscordParams)
  },
})
