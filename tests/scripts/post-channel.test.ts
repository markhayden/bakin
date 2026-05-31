import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

mock.module('../../scripts/lib/registry', () => ({
  addExecTool: mock(),
}))

let mockContentDir = tmpdir()
const contentDirMock = {
  getContentDir: () => mockContentDir,
  getBakinPaths: () => ({ assets: join(mockContentDir, 'assets') }),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}
mock.module('../../src/core/content-dir', () => contentDirMock)
mock.module('@/core/content-dir', () => contentDirMock)

let mockChannelAliases: Record<string, string> = {}
let mockNotificationChannel = ''
let mockNotificationTarget = ''
const settingsMock = {
  getSettings: () => ({
    notifications: {
      channel: mockNotificationChannel,
      target: mockNotificationTarget,
      gateAlerts: true,
      channelAliases: mockChannelAliases,
    },
  }),
}
mock.module('@/core/settings', () => settingsMock)
mock.module('../../src/core/settings', () => settingsMock)

let mockWorkflowAuthorizationError: Error | null = null
const mockAssertWorkflowToolAllowed = mock(async (..._args: unknown[]) => {
  if (mockWorkflowAuthorizationError) throw mockWorkflowAuthorizationError
})
mock.module('@/core/workflow-tool-authorization', () => ({
  assertWorkflowToolAllowed: (...args: unknown[]) => mockAssertWorkflowToolAllowed(...args),
}))
mock.module('../../src/core/workflow-tool-authorization', () => ({
  assertWorkflowToolAllowed: (...args: unknown[]) => mockAssertWorkflowToolAllowed(...args),
}))

import { postChannel } from '../../scripts/lib/post-channel'

describe('postChannel', () => {
  const originalEnv = { ...process.env }
  const deliverContent = mock(async () => ({
    deliveries: [{ channelId: 'discord:channel-123', ref: 'message:1', renderedAt: '2026-04-11T10:00:00Z' }],
  }))
  const listChannels = mock(async () => [{ id: 'discord', label: 'Discord', capabilities: ['message'] }])
  const runtime = {
    channels: { deliverContent, list: listChannels },
  } as unknown as AgentRuntimeAdapter

  beforeEach(() => {
    deliverContent.mockClear()
    listChannels.mockClear()
    mockAssertWorkflowToolAllowed.mockClear()
    mockWorkflowAuthorizationError = null
    mockNotificationChannel = ''
    mockNotificationTarget = ''
    mockChannelAliases = { general: 'discord:channel-123', 'testing-ground': 'discord:test-channel' }
    mockContentDir = tmpdir()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    mock.restore()
  })

  it('routes channel delivery through the runtime adapter', async () => {
    const result = await postChannel({
      channel: '#general',
      content: 'test message',
      agent: 'chef',
      taskId: 'task-123',
    }, runtime)

    expect(result.ok).toBe(true)
    expect(result.channel).toBe('discord:channel-123')
    expect(result.taskId).toBe('task-123')
    expect(deliverContent).toHaveBeenCalledTimes(1)
    const [call] = deliverContent.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(call).toEqual({
      channels: ['discord:channel-123'],
      content: {
        title: 'Channel post',
        body: 'test message',
        files: [],
        metadata: {
          agent: 'chef',
          taskId: 'task-123',
          embed: undefined,
          requestedChannel: '#general',
          resolvedChannel: 'discord:channel-123',
        },
      },
    })
  })

  it('fails before runtime delivery when a bare channel has no alias or runtime channel match', async () => {
    mockChannelAliases = {}

    const result = await postChannel({
      channel: '#general',
      content: 'test message',
      agent: 'chef',
      taskId: 'task-123',
    }, runtime)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('No channel alias configured for #general')
    expect(result.error).toContain('notifications.channelAliases.general')
    expect(deliverContent).not.toHaveBeenCalled()
  })

  it('allows direct runtime channel ids without aliases', async () => {
    mockChannelAliases = {}

    const result = await postChannel({
      channel: 'discord',
      content: 'test message',
      agent: 'chef',
    }, runtime)

    expect(result.ok).toBe(true)
    const [call] = deliverContent.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(call.channels).toEqual(['discord'])
  })

  it('uses the legacy notification target as the default general alias', async () => {
    mockChannelAliases = {}
    mockNotificationChannel = 'discord'
    mockNotificationTarget = 'channel-123'

    const result = await postChannel({
      channel: '#general',
      content: 'test message',
      agent: 'chef',
    }, runtime)

    expect(result.ok).toBe(true)
    expect(result.channel).toBe('discord:channel-123')
    const [call] = deliverContent.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(call.channels).toEqual(['discord:channel-123'])
  })

  it('returns a failed exec result when runtime delivery fails', async () => {
    deliverContent.mockRejectedValueOnce(new Error('channel offline'))

    const result = await postChannel({
      channel: 'general',
      content: 'test',
      agent: 'chef',
    }, runtime)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('channel offline')
  })

  it('returns a failed exec result when workflow policy denies posting', async () => {
    mockWorkflowAuthorizationError = new Error('Workflow channel posts are only allowed from the active output step.')

    const result = await postChannel({
      channel: 'general',
      content: 'test',
      agent: 'chef',
      taskId: 'task-123',
    }, runtime)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('only allowed')
    expect(deliverContent).not.toHaveBeenCalled()
  })

  it('attaches the current-version file of image and video assets resolved by assetId', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'channel-test-'))
    mockContentDir = tmpDir

    // Seed two versioned assets (manifest.json is the source of truth).
    function seed(assetId: string, file: string, mime: string, body: string): string {
      const dir = join(tmpDir, 'assets', 'store', '2026-04', assetId)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, file), body)
      const manifest = {
        assetId, type: 'images', source: { kind: 'generated', path: null },
        agent: 'pixel', taskId: null, created: 'c', updated: 'c',
        currentVersion: 1, description: '', tags: [],
        versions: [{
          version: 1, file, thumb: null, mimeType: mime, size: body.length,
          width: null, height: null, created: 'c', description: '', tags: [],
          op: 'generate', parentVersion: null, tool: null, prompt: null, promptHash: null, generation: null,
        }],
        exports: [],
      }
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
      return join(dir, file)
    }
    const imgAbs = seed('20260401-hero-a1b2c3d4', 'v1.png', 'image/png', 'fake-image')
    const vidAbs = seed('20260401-clip-e5f6a7b8', 'v1.mp4', 'video/mp4', 'fake-video')
    const expectedFiles = [
      { name: 'v1.png', path: imgAbs },
      { name: 'v1.mp4', path: vidAbs },
    ]

    try {
      const result = await postChannel({
        channel: 'general',
        content: 'Post with attachments',
        agent: 'pixel',
        imageAssetId: '20260401-hero-a1b2c3d4',
        videoAssetId: '20260401-clip-e5f6a7b8',
      }, runtime)

      expect(result.ok).toBe(true)
      const [call] = deliverContent.mock.calls[0] as unknown as [Record<string, unknown> & { content: { files: unknown } }]
      expect(call.content.files).toEqual(expectedFiles)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('routes posts to the test channel when test mode is enabled', async () => {
    process.env.BAKIN_CHANNEL_TEST_MODE = '1'

    const result = await postChannel({
      channel: 'general',
      content: 'test',
      agent: 'chef',
    }, runtime)

    expect(result.ok).toBe(true)
    expect(result.channel).toBe('discord:test-channel')
    expect(result.testMode).toBe(true)
    expect(result.requestedChannel).toBe('#general')
    const [call] = deliverContent.mock.calls[0] as unknown as [Record<string, unknown> & { channels: unknown }]
    expect(call.channels).toEqual(['discord:test-channel'])
  })
})
