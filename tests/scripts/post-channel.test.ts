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
    deliveries: [{ channelId: 'general', ref: 'message:1', renderedAt: '2026-04-11T10:00:00Z' }],
  }))
  const runtime = {
    channels: { deliverContent },
  } as unknown as AgentRuntimeAdapter

  beforeEach(() => {
    deliverContent.mockClear()
    mockAssertWorkflowToolAllowed.mockClear()
    mockWorkflowAuthorizationError = null
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
      agent: 'basil',
      taskId: 'task-123',
    }, runtime)

    expect(result.ok).toBe(true)
    expect(result.channel).toBe('#general')
    expect(result.taskId).toBe('task-123')
    expect(deliverContent).toHaveBeenCalledTimes(1)
    const [call] = deliverContent.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(call).toEqual({
      channels: ['general'],
      content: {
        title: 'Channel post',
        body: 'test message',
        files: [],
        metadata: {
          agent: 'basil',
          taskId: 'task-123',
          embed: undefined,
          requestedChannel: '#general',
        },
      },
    })
  })

  it('returns a failed exec result when runtime delivery fails', async () => {
    deliverContent.mockRejectedValueOnce(new Error('channel offline'))

    const result = await postChannel({
      channel: 'general',
      content: 'test',
      agent: 'basil',
    }, runtime)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('channel offline')
  })

  it('returns a failed exec result when workflow policy denies posting', async () => {
    mockWorkflowAuthorizationError = new Error('Workflow channel posts are only allowed from the active output step.')

    const result = await postChannel({
      channel: 'general',
      content: 'test',
      agent: 'basil',
      taskId: 'task-123',
    }, runtime)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('only allowed')
    expect(deliverContent).not.toHaveBeenCalled()
  })

  it('attaches image and video files resolved via pathForFilename', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'channel-test-'))
    mockContentDir = tmpDir
    const imgRel = 'assets/store/2026-04/20260401-hero-a1b2c3d4.png'
    const vidRel = 'assets/store/2026-04/20260401-clip-e5f6a7b8.mp4'
    const imgAbs = join(tmpDir, imgRel)
    const vidAbs = join(tmpDir, vidRel)
    const expectedFiles = [
      { name: '20260401-hero-a1b2c3d4.png', path: imgAbs },
      { name: '20260401-clip-e5f6a7b8.mp4', path: vidAbs },
    ]

    try {
      mkdirSync(dirname(imgAbs), { recursive: true })
      mkdirSync(dirname(vidAbs), { recursive: true })
      writeFileSync(imgAbs, 'fake-image')
      writeFileSync(vidAbs, 'fake-video')

      const result = await postChannel({
        channel: 'general',
        content: 'Post with attachments',
        agent: 'pixel',
        imageFilename: '20260401-hero-a1b2c3d4.png',
        videoFilename: '20260401-clip-e5f6a7b8.mp4',
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
      agent: 'basil',
    }, runtime)

    expect(result.ok).toBe(true)
    expect(result.channel).toBe('#testing-ground')
    expect(result.testMode).toBe(true)
    expect(result.requestedChannel).toBe('#general')
    const [call] = deliverContent.mock.calls[0] as unknown as [Record<string, unknown> & { channels: unknown }]
    expect(call.channels).toEqual(['testing-ground'])
  })
})
