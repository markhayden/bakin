import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('../../scripts/lib/registry', () => ({
  addExecTool: vi.fn(),
}))

import { postDiscord } from '../../scripts/lib/post-discord'

describe('postDiscord', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.DISCORD_BOT_TOKEN = 'test-bot-token'
    process.env.DISCORD_CHANNEL_GENERAL = '111111111111'
    process.env.DISCORD_CHANNEL_APPROVALS = '222222222222'
    process.env.DISCORD_CHANNEL_CONTENT = '333333333333'
    process.env.DISCORD_GUILD_ID = '999999999999'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('fails for unknown channel', async () => {
    const result = await postDiscord({
      channel: 'nonexistent',
      content: 'hello',
      agent: 'basil',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unknown Discord channel')
    expect(result.error).toContain('general')
  })

  it('fails when DISCORD_BOT_TOKEN is missing', async () => {
    delete process.env.DISCORD_BOT_TOKEN
    const result = await postDiscord({
      channel: 'general',
      content: 'hello',
      agent: 'basil',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('DISCORD_BOT_TOKEN')
  })

  it('strips # prefix from channel name', async () => {
    // Mock fetch to verify channel resolution works with #
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-1', channel_id: '111111111111' }),
    } as Response)

    const result = await postDiscord({
      channel: '#general',
      content: 'test message',
      agent: 'basil',
    })
    expect(result.ok).toBe(true)
    expect(result.channel).toBe('#general')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/channels/111111111111/messages',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('posts successfully and returns message info', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-42', channel_id: '111111111111' }),
    } as Response)

    const result = await postDiscord({
      channel: 'general',
      content: 'New post!',
      agent: 'basil',
      taskId: 'task-123',
    })
    expect(result.ok).toBe(true)
    expect(result.messageId).toBe('msg-42')
    expect(result.channel).toBe('#general')
    expect(result.url).toContain('discord.com/channels/999999999999')
    expect(result.taskId).toBe('task-123')
  })

  it('handles Discord API error response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Missing Permissions',
    } as Response)

    const result = await postDiscord({
      channel: 'general',
      content: 'test',
      agent: 'basil',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('403')
    expect(result.error).toContain('Missing Permissions')
  })

  it('handles fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network unreachable'))

    const result = await postDiscord({
      channel: 'general',
      content: 'test',
      agent: 'basil',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('network unreachable')
  })

  it('uses BEACON_DISCORD_CHANNELS env for custom mapping', async () => {
    process.env.BEACON_DISCORD_CHANNELS = JSON.stringify({
      custom: '444444444444',
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-99', channel_id: '444444444444' }),
    } as Response)

    const result = await postDiscord({
      channel: 'custom',
      content: 'test',
      agent: 'basil',
    })
    expect(result.ok).toBe(true)
  })

  it('attaches image and video files', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'discord-test-'))
    const imgPath = join(tmpDir, 'hero.png')
    const vidPath = join(tmpDir, 'clip.mp4')
    writeFileSync(imgPath, 'fake-image')
    writeFileSync(vidPath, 'fake-video')

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-att', channel_id: '111111111111' }),
    } as Response)

    const result = await postDiscord({
      channel: 'general',
      content: 'Post with attachments',
      agent: 'pixel',
      imagePath: imgPath,
      videoPath: vidPath,
    })

    expect(result.ok).toBe(true)
    // Verify FormData was sent (fetch was called with a body)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('channels/111111111111'),
      expect.objectContaining({ method: 'POST' }),
    )

    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('skips nonexistent attachment files', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-skip', channel_id: '111111111111' }),
    } as Response)

    const result = await postDiscord({
      channel: 'general',
      content: 'Post with missing attachments',
      agent: 'pixel',
      imagePath: '/nonexistent/image.png',
      videoPath: '/nonexistent/video.mp4',
    })

    expect(result.ok).toBe(true)
  })

  it('omits url when DISCORD_GUILD_ID is not set', async () => {
    delete process.env.DISCORD_GUILD_ID

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-1', channel_id: '111111111111' }),
    } as Response)

    const result = await postDiscord({
      channel: 'general',
      content: 'test',
      agent: 'basil',
    })
    expect(result.ok).toBe(true)
    expect(result.url).toBeUndefined()
  })
})
