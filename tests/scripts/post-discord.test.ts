import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('../../scripts/lib/registry', () => ({
  addExecTool: vi.fn(),
}))

// Tests are resolver-driven: each test seeds the resolver with a synthetic
// filename → relative path mapping, and the resolver joins that with the
// mocked content dir to produce the absolute path the discord sender reads.
const resolverMap = new Map<string, string>()
let mockContentDir = tmpdir()
vi.mock('../../plugins/assets/lib/resolver', () => ({
  resolveFilename: (filename: string) => resolverMap.get(filename) ?? null,
}))
vi.mock('../../src/core/content-dir', () => ({
  getContentDir: () => mockContentDir,
  getBakinPaths: () => ({ assets: join(mockContentDir, 'assets') }),
}))

import { postDiscord, _resetChannelCache } from '../../scripts/lib/post-discord'

// Discord channel discovery response for tests
const MOCK_CHANNELS = [
  { id: '111111111111', name: 'general', type: 0 },
  { id: '222222222222', name: 'approvals', type: 0 },
  { id: '333333333333', name: 'content', type: 0 },
]

describe('postDiscord', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.DISCORD_BOT_TOKEN = 'test-bot-token'
    process.env.DISCORD_GUILD_ID = '999999999999'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    _resetChannelCache()
    resolverMap.clear()
    vi.restoreAllMocks()
  })

  /**
   * Helper: mock fetch to handle both channel discovery and message posting.
   * First call to /guilds/.../channels returns the channel list.
   * Subsequent calls to /channels/.../messages return a posted message.
   */
  function mockFetchWithDiscovery(msgResponse?: { id: string; channel_id: string }) {
    const msg = msgResponse || { id: 'msg-1', channel_id: '111111111111' }
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/guilds/') && urlStr.includes('/channels')) {
        return { ok: true, json: async () => MOCK_CHANNELS } as Response
      }
      return { ok: true, json: async () => msg } as Response
    })
  }

  it('fails for unknown channel', async () => {
    mockFetchWithDiscovery()
    const result = await postDiscord({
      channel: 'nonexistent',
      content: 'hello',
      agent: 'basil',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unknown Discord channel')
    expect(result.error).toContain('general')
  })

  it('fails when Discord is not configured', async () => {
    delete process.env.DISCORD_BOT_TOKEN
    delete process.env.DISCORD_GUILD_ID
    // Prevent fallback to openclaw.json on this machine
    const origHome = process.env.HOME
    const origOpenClawHome = process.env.OPENCLAW_HOME
    process.env.HOME = '/tmp/nonexistent-home'
    process.env.OPENCLAW_HOME = '/tmp/nonexistent-openclaw'
    try {
      const result = await postDiscord({
        channel: 'general',
        content: 'hello',
        agent: 'basil',
      })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Discord not configured')
    } finally {
      process.env.HOME = origHome
      if (origOpenClawHome !== undefined) process.env.OPENCLAW_HOME = origOpenClawHome
      else delete process.env.OPENCLAW_HOME
    }
  })

  it('strips # prefix from channel name', async () => {
    const mockFetch = mockFetchWithDiscovery({ id: 'msg-1', channel_id: '111111111111' })

    const result = await postDiscord({
      channel: '#general',
      content: 'test message',
      agent: 'basil',
    })
    expect(result.ok).toBe(true)
    expect(result.channel).toBe('#general')
    // Verify message was posted to the correct channel
    const postCall = mockFetch.mock.calls.find(c =>
      (typeof c[0] === 'string' ? c[0] : c[0].toString()).includes('/channels/111111111111/messages')
    )
    expect(postCall).toBeTruthy()
  })

  it('posts successfully and returns message info', async () => {
    mockFetchWithDiscovery({ id: 'msg-42', channel_id: '111111111111' })

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
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/guilds/') && urlStr.includes('/channels')) {
        return { ok: true, json: async () => MOCK_CHANNELS } as Response
      }
      return { ok: false, status: 403, text: async () => 'Missing Permissions' } as Response
    })

    const result = await postDiscord({
      channel: 'general',
      content: 'test',
      agent: 'basil',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('403')
    expect(result.error).toContain('Missing Permissions')
  })

  it('handles fetch error on message post', async () => {
    let callCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/guilds/') && urlStr.includes('/channels')) {
        return { ok: true, json: async () => MOCK_CHANNELS } as Response
      }
      throw new Error('network unreachable')
    })

    const result = await postDiscord({
      channel: 'general',
      content: 'test',
      agent: 'basil',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('network unreachable')
  })

  it('attaches image and video files resolved via the filename resolver', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'discord-test-'))
    mockContentDir = tmpDir
    const imgRel = 'assets/images/task-1/20260401-hero-a1b2c3d4.png'
    const vidRel = 'assets/video/task-1/20260401-clip-e5f6a7b8.mp4'
    const imgAbs = join(tmpDir, imgRel)
    const vidAbs = join(tmpDir, vidRel)
    // materialise on disk so existsSync passes
    const { mkdirSync } = await import('fs')
    const { dirname } = await import('path')
    mkdirSync(dirname(imgAbs), { recursive: true })
    mkdirSync(dirname(vidAbs), { recursive: true })
    writeFileSync(imgAbs, 'fake-image')
    writeFileSync(vidAbs, 'fake-video')
    resolverMap.set('20260401-hero-a1b2c3d4.png', imgRel)
    resolverMap.set('20260401-clip-e5f6a7b8.mp4', vidRel)

    const mockFetch = mockFetchWithDiscovery({ id: 'msg-att', channel_id: '111111111111' })

    const result = await postDiscord({
      channel: 'general',
      content: 'Post with attachments',
      agent: 'pixel',
      imageFilename: '20260401-hero-a1b2c3d4.png',
      videoFilename: '20260401-clip-e5f6a7b8.mp4',
    })

    expect(result.ok).toBe(true)
    const postCall = mockFetch.mock.calls.find(c =>
      (typeof c[0] === 'string' ? c[0] : c[0].toString()).includes('/channels/111111111111/messages')
    )
    expect(postCall).toBeTruthy()

    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('skips attachments when filename is not registered in the resolver', async () => {
    mockFetchWithDiscovery({ id: 'msg-skip', channel_id: '111111111111' })

    const result = await postDiscord({
      channel: 'general',
      content: 'Post with missing attachments',
      agent: 'pixel',
      imageFilename: 'unknown-image.png',
      videoFilename: 'unknown-video.mp4',
    })

    expect(result.ok).toBe(true)
  })

  it('handles channel discovery failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/guilds/') && urlStr.includes('/channels')) {
        return { ok: false, status: 401, text: async () => 'Unauthorized' } as Response
      }
      return { ok: true, json: async () => ({ id: 'msg-1', channel_id: '111' }) } as Response
    })

    const result = await postDiscord({
      channel: 'general',
      content: 'test',
      agent: 'basil',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unknown Discord channel')
  })
})
