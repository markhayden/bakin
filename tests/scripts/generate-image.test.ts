import { describe, it, expect, beforeEach, mock, spyOn, type Mock } from 'bun:test'

(() => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  process.env.BAKIN_HOME = mkdtempSync(join(tmpdir(), 'bakin-test-home-'))
  process.env.OPENCLAW_HOME = mkdtempSync(join(tmpdir(), 'bakin-test-openclaw-'))
})()

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/content-dir', () => ({
  getContentDir: mock(() => '/tmp/bakin-test'),
  getBakinPaths: mock(() => ({
    home: '/tmp/bakin-test',
    assets: '/tmp/bakin-test/assets',
    'assets.store': '/tmp/bakin-test/assets/store',
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
})),
}))

mock.module('../../scripts/lib/registry', () => ({
  addExecTool: mock(),
}))

mock.module('../../plugins/assets/lib/save-asset', () => ({
  saveAsset: mock(),
}))

mock.module('child_process', () => ({
  execFileSync: mock(() => Buffer.from('1080,1920')),
}))

let mockRuntimeConfig: Record<string, unknown> = {}

mock.module('../../src/core/app-services', () => ({
  getAppServices: () => ({
    runtime: {
      config: {
        get: async () => mockRuntimeConfig,
      },
    },
  }),
}))

mock.module('fs', () => {
  const actual = require('fs') as Record<string, unknown>
  return {
    ...actual,
    existsSync: mock(() => true),
    mkdirSync: mock(),
    writeFileSync: mock(),
  }
})

// Mock fetch for Gemini API calls
const mockFetchResponse = (imageData = 'fakebase64data') => ({
  ok: true,
  json: async () => ({
    candidates: [{
      content: {
        parts: [{
          inlineData: { mimeType: 'image/jpeg', data: imageData },
        }],
      },
    }],
  }),
}) as unknown as Response

import { generateImage } from '../../scripts/lib/generate-image'
import { saveAsset } from '../../plugins/assets/lib/save-asset'
import { existsSync } from 'fs'
import { execFileSync } from 'child_process'

const mockSaveAsset = vi.mocked(saveAsset)

describe('generateImage', () => {
  beforeEach(() => {
    mock.clearAllMocks()
    mockRuntimeConfig = {}
    // Set API key for tests
    process.env.GEMINI_API_KEY = 'test-key-123'
  })

  it('calls Gemini API and saves asset on success', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())
    mockSaveAsset.mockResolvedValue({
      ok: true,
      path: 'assets/images/task-123/20260326-test.jpg',
      metadataPath: 'assets/images/task-123/20260326-test.jpg.meta.json',
      filename: '20260326-test.jpg',
    })

    const result = await generateImage({
      prompt: 'Golden hour smoothie',
      taskId: 'task-123',
      agent: 'pixel',
      preset: 'social-portrait',
      thumbnail: false,
    })

    expect(result.ok).toBe(true)
    expect(result.width).toBe(1080)
    expect(result.height).toBe(1920)
    expect(result.preset).toBe('social-portrait')
    expect(result.model).toContain('flash')
    expect(mockSaveAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-123',
        type: 'images',
        tool: 'gemini-3.1-flash-image-preview',
      }),
    )
    // Verify Gemini API was called with flash model
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('gemini-3.1-flash-image-preview'),
      expect.anything(),
    )
  })

  it('uses pro model when specified', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())
    mockSaveAsset.mockResolvedValue({ ok: true, path: 'x', metadataPath: 'x.meta.json', filename: 'x.jpg' })

    const result = await generateImage({
      prompt: 'test',
      taskId: 'task-pro',
      agent: 'pixel',
      model: 'pro',
      thumbnail: false,
    })

    expect(result.ok).toBe(true)
    expect(result.model).toContain('pro')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('gemini-3-pro-image-preview'),
      expect.anything(),
    )
  })

  it('uses social-square preset dimensions', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())
    mockSaveAsset.mockResolvedValue({ ok: true, path: 'x', metadataPath: 'x.meta.json', filename: 'x.jpg' })

    const result = await generateImage({
      prompt: 'test',
      taskId: 'task-sq',
      agent: 'pixel',
      preset: 'social-square',
      thumbnail: false,
    })

    expect(result.ok).toBe(true)
    expect(result.width).toBe(1080)
    expect(result.height).toBe(1080)
  })

  it('caps custom dimensions at MAX_IMAGE_EDGE', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())
    mockSaveAsset.mockResolvedValue({ ok: true, path: 'x', metadataPath: 'x.meta.json', filename: 'x.jpg' })

    const result = await generateImage({
      prompt: 'test',
      taskId: 'task-big',
      agent: 'pixel',
      preset: 'custom',
      width: 5000,
      height: 3000,
      thumbnail: false,
    })

    expect(result.ok).toBe(true)
    expect(result.width).toBe(1200)
    expect(result.height).toBe(1200)
  })

  it('fails when no API key is available', async () => {
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_AI_API_KEY

    const result = await generateImage({
      prompt: 'test',
      taskId: 'task-nokey',
      agent: 'pixel',
      thumbnail: false,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('No Gemini API key')
  })

  it('reads Gemini API key from runtime skill env config', async () => {
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_AI_API_KEY
    mockRuntimeConfig = {
      skills: {
        entries: {
          'nano-banana-pro': {
            env: {
              GEMINI_API_KEY: 'config-key-123',
            },
          },
        },
      },
    }

    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())
    mockSaveAsset.mockResolvedValue({ ok: true, path: 'x', metadataPath: 'x.meta.json', filename: 'x.jpg' })

    const result = await generateImage({
      prompt: 'test',
      taskId: 'task-config-key',
      agent: 'pixel',
      thumbnail: false,
    })

    expect(result.ok).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('key=config-key-123'),
      expect.anything(),
    )
  })

  it('reads Gemini API key from runtime Google provider config', async () => {
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_AI_API_KEY
    mockRuntimeConfig = {
      models: {
        providers: {
          google: {
            apiKey: 'provider-key-123',
          },
        },
      },
      agents: {
        defaults: {
          imageGenerationModel: {
            primary: 'google/gemini-3-pro-image-preview',
          },
        },
      },
    }

    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())
    mockSaveAsset.mockResolvedValue({ ok: true, path: 'x', metadataPath: 'x.meta.json', filename: 'x.jpg' })

    const result = await generateImage({
      prompt: 'test',
      taskId: 'task-google-provider',
      agent: 'pixel',
      thumbnail: false,
    })

    expect(result.ok).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('key=provider-key-123'),
      expect.anything(),
    )
  })

  it('returns fail when Gemini API returns error', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    } as Response)

    const result = await generateImage({
      prompt: 'test',
      taskId: 'task-rate',
      agent: 'pixel',
      thumbnail: false,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('after retries')
  }, 30_000)

  it('returns fail when asset save fails', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())
    mockSaveAsset.mockResolvedValue({ ok: false, error: 'disk full' })

    const result = await generateImage({
      prompt: 'test',
      taskId: 'task-disk',
      agent: 'pixel',
      thumbnail: false,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('asset save failed')
  })

  it('truncates prompt in return value to 500 chars', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())
    mockSaveAsset.mockResolvedValue({ ok: true, path: 'x', metadataPath: 'x.meta.json', filename: 'x.jpg' })

    const longPrompt = 'a'.repeat(1000)
    const result = await generateImage({
      prompt: longPrompt,
      taskId: 'task-long',
      agent: 'pixel',
      thumbnail: false,
    })

    expect(result.ok).toBe(true)
    expect((result.prompt as string).length).toBe(500)
  })

  it('imports raw file through asset pipeline via filePath', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('1080,1920'))
    mockSaveAsset.mockResolvedValue({
      ok: true,
      path: 'assets/images/task-raw/20260404-imported.jpg',
      metadataPath: 'assets/images/task-raw/20260404-imported.jpg.meta.json',
      filename: '20260404-imported.jpg',
    })

    const result = await generateImage({
      filePath: '/tmp/some-image.jpg',
      prompt: 'Backstroke takeoff',
      taskId: 'task-raw',
      agent: 'pixel',
      thumbnail: false,
    })

    expect(result.ok).toBe(true)
    expect(result.model).toBe('raw-import')
    expect(result.width).toBe(1080)
    expect(result.height).toBe(1920)
    expect(result.path).toContain('assets/images/task-raw')
    expect(mockSaveAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-raw',
        type: 'images',
        tool: 'raw-import',
        tags: ['imported'],
      }),
    )
    // Should NOT call Gemini API
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('fails raw import when file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false)

    const result = await generateImage({
      filePath: '/tmp/nonexistent.jpg',
      taskId: 'task-missing',
      agent: 'pixel',
      thumbnail: false,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('File not found')
  })

  it('fails when neither prompt nor filePath is provided', async () => {
    const result = await generateImage({
      taskId: 'task-empty',
      agent: 'pixel',
      thumbnail: false,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Either prompt or filePath is required')
  })
})
