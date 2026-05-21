import { describe, it, expect, beforeEach, afterAll, mock, spyOn } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { resetContentDir } from '../../src/core/content-dir'

const originalBakinHome = process.env.BAKIN_HOME
const originalOpenclawHome = process.env.OPENCLAW_HOME
const testBakinHome = mkdtempSync(join(tmpdir(), 'bakin-test-home-'))
const testOpenclawHome = mkdtempSync(join(tmpdir(), 'bakin-test-openclaw-'))
process.env.BAKIN_HOME = testBakinHome
process.env.OPENCLAW_HOME = testOpenclawHome

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../scripts/lib/registry', () => ({
  addExecTool: mock(),
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

describe('generateImage', () => {
  afterAll(() => {
    if (originalBakinHome === undefined) delete process.env.BAKIN_HOME
    else process.env.BAKIN_HOME = originalBakinHome
    if (originalOpenclawHome === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = originalOpenclawHome
    rmSync(testBakinHome, { recursive: true, force: true })
    rmSync(testOpenclawHome, { recursive: true, force: true })
    resetContentDir()
  })

  beforeEach(() => {
    mock.clearAllMocks()
    mockRuntimeConfig = {}
    process.env.BAKIN_HOME = testBakinHome
    process.env.OPENCLAW_HOME = testOpenclawHome
    resetContentDir()
    // Set API key for tests
    process.env.GEMINI_API_KEY = 'test-key-123'
  })

  it('calls Gemini API and saves asset on success', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())

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
    expect(result.path).toContain('assets/store/')
    expect(result.metadataPath).toBe(`${result.path}.meta.json`)
    expect(result.filename).toBe(basename(result.path as string))
    expect(result.image_filename).toBe(result.filename)
    // Verify Gemini API was called with flash model
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('gemini-3.1-flash-image-preview'),
      expect.anything(),
    )
  })

  it('uses pro model when specified', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())

    const result = await generateImage({
      prompt: 'test',
      taskId: 'task-pro',
      agent: 'pixel',
      model: 'pro',
      thumbnail: false,
    })

    expect(result.ok).toBe(true)
    expect(result.filename).toBeDefined()
    expect(result.image_filename).toBe(result.filename)
    expect(result.model).toContain('pro')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('gemini-3-pro-image-preview'),
      expect.anything(),
    )
  })

  it('uses social-square preset dimensions', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())

    const result = await generateImage({
      prompt: 'test',
      taskId: 'task-sq',
      agent: 'pixel',
      preset: 'social-square',
      thumbnail: false,
    })

    expect(result.ok).toBe(true)
    expect(result.filename).toBeDefined()
    expect(result.image_filename).toBe(result.filename)
    expect(result.width).toBe(1080)
    expect(result.height).toBe(1080)
  })

  it('caps custom dimensions at MAX_IMAGE_EDGE', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())

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
    expect(result.filename).toBeDefined()
    expect(result.image_filename).toBe(result.filename)
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
    const brokenHome = mkdtempSync(join(tmpdir(), 'bakin-test-broken-home-'))
    process.env.BAKIN_HOME = brokenHome
    resetContentDir()
    writeFileSync(join(brokenHome, 'assets'), 'not-a-directory')
    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())

    const result = await generateImage({
      prompt: 'test',
      taskId: 'task-disk',
      agent: 'pixel',
      thumbnail: false,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('asset save failed')
    rmSync(brokenHome, { recursive: true, force: true })
    process.env.BAKIN_HOME = testBakinHome
    resetContentDir()
  })

  it('truncates prompt in return value to 500 chars', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse())

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
    const sourceDir = mkdtempSync(join(tmpdir(), 'bakin-test-image-src-'))
    const sourceFile = join(sourceDir, 'some-image.jpg')
    writeFileSync(sourceFile, 'not-a-real-jpeg')

    const result = await generateImage({
      filePath: sourceFile,
      prompt: 'Backstroke takeoff',
      taskId: 'task-raw',
      agent: 'pixel',
      thumbnail: false,
    })

    expect(result.ok).toBe(true)
    expect(result.model).toBe('raw-import')
    expect(result.filename).toBe(basename(result.path as string))
    expect(result.image_filename).toBe(result.filename)
    expect(result.path).toContain('assets/store/')
    // Should NOT call Gemini API
    expect(globalThis.fetch).not.toHaveBeenCalled()
    rmSync(sourceDir, { recursive: true, force: true })
  })

  it('fails raw import when file does not exist', async () => {
    const result = await generateImage({
      filePath: join(testBakinHome, 'nonexistent.jpg'),
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
