import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/core/content-dir', () => ({
  getBakinPaths: vi.fn(() => ({
    home: '/tmp/bakin-test',
    'assets.images': '/tmp/bakin-test/assets/images',
  })),
}))

vi.mock('../../scripts/lib/registry', () => ({
  addExecTool: vi.fn(),
}))

vi.mock('../../plugins/assets/lib/save-asset', () => ({
  saveAsset: vi.fn(),
}))

vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => Buffer.from('1080,1920')),
}))

let mockOpenClawConfig: string | null = null

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  const origReadFileSync = actual.readFileSync as Function
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn((...args: unknown[]) => {
      // Block reading openclaw config in tests unless a test explicitly provides it.
      if (typeof args[0] === 'string' && (args[0] as string).includes('openclaw.json')) {
        if (mockOpenClawConfig !== null) return mockOpenClawConfig
        throw new Error('mocked: not found')
      }
      return origReadFileSync(...args)
    }),
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
    vi.clearAllMocks()
    mockOpenClawConfig = null
    // Set API key for tests
    process.env.GEMINI_API_KEY = 'test-key-123'
  })

  it('calls Gemini API and saves asset on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())
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

  it('reads Gemini API key from openclaw skill env config', async () => {
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_AI_API_KEY
    mockOpenClawConfig = JSON.stringify({
      skills: {
        entries: {
          'nano-banana-pro': {
            env: {
              GEMINI_API_KEY: 'config-key-123',
            },
          },
        },
      },
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())
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

  it('returns fail when Gemini API returns error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())
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
