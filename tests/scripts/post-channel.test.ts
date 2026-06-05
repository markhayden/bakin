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

import { CHANNEL_POST_CHUNK_LIMIT, chunkChannelPostContent, postChannel, resetPostChannelIdempotencyForTests } from '../../scripts/lib/post-channel'

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
    resetPostChannelIdempotencyForTests()
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
        title: '',
        body: 'test message',
        files: [],
        metadata: {
          agent: 'chef',
          taskId: 'task-123',
          embed: undefined,
          chunkCount: 1,
          chunkIndex: 1,
          requestedChannel: '#general',
          resolvedChannel: 'discord:channel-123',
        },
      },
    })
  })

  it('keeps near-threshold payloads as one unwrapped delivery', async () => {
    const content = `Runtime Roundup\n\n${'A'.repeat(1500)}\n\nLinks\n${'B'.repeat(250)}`

    const result = await postChannel({
      channel: '#general',
      content,
      agent: 'chef',
      taskId: 'task-123',
    }, runtime)

    expect(result.ok).toBe(true)
    expect(result.chunkCount).toBe(1)
    expect(deliverContent).toHaveBeenCalledTimes(1)
    const [call] = deliverContent.mock.calls[0] as unknown as [Record<string, unknown> & { content: { body: string; title: string } }]
    expect(call.content.title).toBe('')
    expect(call.content.body).toBe(content)
    expect(call.content.body.startsWith('Channel post')).toBe(false)
    expect(call.content.body.length).toBeLessThanOrEqual(CHANNEL_POST_CHUNK_LIMIT)
  })

  it('splits long payloads deterministically with ordered chunk prefixes', async () => {
    const content = [
      '**Runtime Roundup**',
      `OpenClaw ${'alpha '.repeat(180)}`,
      `Hermes ${'beta '.repeat(180)}`,
      `DeerFlow ${'gamma '.repeat(180)}`,
      `Links ${'delta '.repeat(180)}`,
    ].join('\n\n')

    const result = await postChannel({
      channel: '#general',
      content,
      agent: 'chef',
      taskId: 'task-123',
    }, runtime)

    expect(result.ok).toBe(true)
    expect(result.chunkCount).toBe(3)
    expect(deliverContent).toHaveBeenCalledTimes(3)
    const bodies = deliverContent.mock.calls.map(call => {
      const [arg] = call as unknown as [Record<string, unknown> & { content: { body: string; title: string; files: unknown[]; metadata: Record<string, unknown> } }]
      expect(arg.content.title).toBe('')
      expect(arg.content.body.length).toBeLessThanOrEqual(CHANNEL_POST_CHUNK_LIMIT)
      return arg.content.body
    })
    expect(bodies[0]?.startsWith('[1/3] ')).toBe(true)
    expect(bodies[1]?.startsWith('[2/3] ')).toBe(true)
    expect(bodies[2]?.startsWith('[3/3] ')).toBe(true)
    expect(bodies.join('\n')).toContain('OpenClaw')
    expect(bodies.join('\n')).toContain('DeerFlow')
    expect(bodies.join('\n')).not.toContain('Channel post')
  })

  it('exposes deterministic chunks for harness-style regression checks', () => {
    const oneChunk = chunkChannelPostContent('x'.repeat(1800))
    const twoChunks = chunkChannelPostContent(`${'one '.repeat(450)}\n\n${'two '.repeat(450)}`)

    expect(oneChunk).toHaveLength(1)
    expect(oneChunk[0]?.startsWith('[1/1]')).toBe(false)
    expect(twoChunks.length).toBeGreaterThan(1)
    expect(twoChunks.every(chunk => chunk.length <= CHANNEL_POST_CHUNK_LIMIT)).toBe(true)
    expect(twoChunks[0]?.startsWith('[1/')).toBe(true)
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

  it('deduplicates identical channel-post retries, including ambiguous failures', async () => {
    deliverContent.mockRejectedValueOnce(new Error('adapter returned after posting'))

    const params = {
      channel: 'general',
      content: 'Pixel made the space pig',
      agent: 'pixel',
      taskId: 'task-image',
      imageAssetId: '20260601-space-pig-a1b2c3d4',
    }

    const first = await postChannel(params, runtime)
    const second = await postChannel(params, runtime)

    expect(first.ok).toBe(false)
    expect(second.ok).toBe(false)
    expect(second.deduped).toBe(true)
    expect(deliverContent).toHaveBeenCalledTimes(1)
  })

  it('shares an in-flight identical channel post instead of sending twice', async () => {
    deliverContent.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      return {
        deliveries: [{ channelId: 'discord:channel-123', ref: 'message:1', renderedAt: '2026-04-11T10:00:00Z' }],
      }
    })

    const params = {
      channel: 'general',
      content: 'Pixel made the space pig',
      agent: 'pixel',
      taskId: 'task-image',
      imageAssetId: '20260601-space-pig-a1b2c3d4',
    }
    const [first, second] = await Promise.all([
      postChannel(params, runtime),
      postChannel(params, runtime),
    ])

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(deliverContent).toHaveBeenCalledTimes(1)
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
      { name: '20260401-hero-a1b2c3d4.png', path: imgAbs },
      { name: '20260401-clip-e5f6a7b8.mp4', path: vidAbs },
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
