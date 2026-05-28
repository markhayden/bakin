import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import sharp from 'sharp'
import type { PluginContext } from '@bakin/core/plugin-types'
import { resetContentDir } from '../../../src/core/content-dir'

let testDir = join(tmpdir(), `bakin-images-tools-${Date.now()}`)

import { exportImage, generateImage, importImage } from '../../../plugins/images/lib/tools'

const originalOpenAI = process.env.OPENAI_API_KEY
const originalGemini = process.env.GEMINI_API_KEY
const originalGoogle = process.env.GOOGLE_AI_API_KEY
const originalBakinHome = process.env.BAKIN_HOME

function makeContext(overrides: Partial<PluginContext> = {}) {
  const saved: Array<Record<string, unknown>> = []
  const ctx = {
    getSettings: mock(() => ({})),
    assets: {
      save: mock(async (input: Record<string, unknown>) => {
        saved.push(input)
        return {
          ok: true,
          path: 'assets/store/2026-05/20260528-image-a1b2c3d4.png',
          metadataPath: 'assets/store/2026-05/20260528-image-a1b2c3d4.png.meta.json',
          filename: '20260528-image-a1b2c3d4.png',
        }
      }),
      getByFilename: mock(async () => null),
    },
    runtime: {
      config: {
        get: mock(async () => ({})),
      },
    },
    ...overrides,
  } as unknown as PluginContext
  return { ctx, saved }
}

function imageResponse(mimeType = 'image/png') {
  return {
    ok: true,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{ inlineData: { mimeType, data: Buffer.from('fake-image').toString('base64') } }],
        },
      }],
    }),
  } as unknown as Response
}

describe('images tools', () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `bakin-images-tools-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    process.env.BAKIN_HOME = testDir
    resetContentDir()
    process.env.GEMINI_API_KEY = 'gemini-key'
    process.env.OPENAI_API_KEY = 'openai-key'
    delete process.env.GOOGLE_AI_API_KEY
  })

  afterEach(() => {
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAI
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = originalGemini
    if (originalGoogle === undefined) delete process.env.GOOGLE_AI_API_KEY
    else process.env.GOOGLE_AI_API_KEY = originalGoogle
    if (originalBakinHome === undefined) delete process.env.BAKIN_HOME
    else process.env.BAKIN_HOME = originalBakinHome
    resetContentDir()
    rmSync(testDir, { recursive: true, force: true })
    mock.restore()
  })

  it('generates with Gemini current model ids and saves generation metadata', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(imageResponse())
    const { ctx, saved } = makeContext()

    const result = await generateImage(ctx, {
      prompt: 'Golden hour smoothie',
      taskId: 'task-1',
      provider: 'google',
      model: 'gemini-3.1-flash-image-preview',
      surface: 'instagram-story',
    }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.image_filename).toBe('20260528-image-a1b2c3d4.png')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('gemini-3.1-flash-image-preview:generateContent'),
      expect.anything(),
    )
    expect(saved[0].generation).toMatchObject({
      provider: 'google',
      model: 'gemini-3.1-flash-image-preview',
      surface: 'instagram-story',
      width: 1080,
      height: 1920,
      createdByTool: 'bakin_exec_images_generate',
    })
  })

  it('generates with OpenAI and saves canonical image filename fields', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('openai-image').toString('base64') }] }),
    } as unknown as Response)
    const { ctx, saved } = makeContext()

    const result = await generateImage(ctx, {
      prompt: 'Blog hero image',
      taskId: 'task-openai',
      provider: 'openai',
      model: 'gpt-image-2',
      surface: 'blog-hero',
      quality: 'premium',
    }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.filename).toBe(result.image_filename)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/images/generations',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer openai-key' }),
      }),
    )
    expect(saved[0].generation).toMatchObject({
      provider: 'openai',
      model: 'gpt-image-2',
      surface: 'blog-hero',
      width: 1600,
      height: 900,
      quality: 'premium',
    })
  })

  it('sends OpenAI a supported size for non-square surfaces', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('openai-image').toString('base64') }] }),
    } as unknown as Response)
    const { ctx } = makeContext()

    // instagram-story is 1080x1920 (portrait) — the raw dimensions are not a
    // size OpenAI accepts, so the adapter must snap to a supported portrait size.
    await generateImage(ctx, {
      prompt: 'Portrait promo',
      taskId: 'task-size',
      provider: 'openai',
      model: 'gpt-image-2',
      surface: 'instagram-story',
    }, 'pixel')

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.size).toBe('1024x1536')
  })

  it('falls back to the native adapter when runtime generation fails', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(imageResponse())
    const runtimeGenerate = mock(async () => { throw new Error('runtime exploded') })
    const { ctx, saved } = makeContext({
      runtime: {
        images: {
          providers: mock(async () => [
            {
              id: 'google',
              label: 'Google Gemini',
              configured: true,
              defaultModel: 'gemini-3.1-flash-image-preview',
              models: ['gemini-3.1-flash-image-preview'],
              capabilities: { generate: { maxCount: 4 } },
            },
          ]),
          generate: runtimeGenerate,
        },
        config: { get: mock(async () => ({})) },
      } as never,
    })

    const result = await generateImage(ctx, {
      prompt: 'Resilient render',
      taskId: 'task-fallback',
      provider: 'google',
      model: 'gemini-3.1-flash-image-preview',
      surface: 'instagram-square',
    }, 'pixel')

    expect(result.ok).toBe(true)
    expect(runtimeGenerate).toHaveBeenCalled()
    expect(globalThis.fetch).toHaveBeenCalled()
    expect(result.routeSource).toBe('native')
    expect(saved[0].generation).toMatchObject({ routeSource: 'native' })
  })

  it('prefers configured runtime image generation before direct provider adapters', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('direct fetch should not be called'))
    const runtimeFile = join(testDir, 'runtime-generated.png')
    writeFileSync(runtimeFile, 'runtime-image')
    const runtimeGenerate = mock(async () => ({
      provider: 'openai',
      model: 'gpt-image-2',
      providerText: 'runtime revised prompt',
      images: [{ filePath: runtimeFile, mimeType: 'image/png', width: 1024, height: 1024 }],
    }))
    const { ctx, saved } = makeContext({
      runtime: {
        images: {
          providers: mock(async () => [
            {
              id: 'openai',
              label: 'OpenAI',
              configured: true,
              defaultModel: 'gpt-image-2',
              models: ['gpt-image-2'],
              capabilities: { generate: { maxCount: 4, supportsSize: true } },
            },
          ]),
          generate: runtimeGenerate,
        },
        config: {
          get: mock(async () => ({})),
        },
      } as never,
    })

    const result = await generateImage(ctx, {
      prompt: 'Codex-routed test image',
      taskId: 'task-runtime',
      provider: 'openai',
      model: 'gpt-image-2',
      surface: 'blog-hero',
    }, 'pixel')

    expect(result.ok).toBe(true)
    expect(runtimeGenerate).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      model: 'gpt-image-2',
      width: 1600,
      height: 900,
    }))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(saved[0]).toMatchObject({ filePath: runtimeFile })
    expect(saved[0].generation).toMatchObject({
      provider: 'openai',
      model: 'gpt-image-2',
      routeSource: 'runtime',
    })
  })

  it('imports a local image file through assets', async () => {
    const filePath = join(testDir, 'raw.jpg')
    writeFileSync(filePath, 'not-really-an-image')
    const { ctx, saved } = makeContext()

    const result = await importImage(ctx, {
      filePath,
      taskId: 'task-import',
      description: 'Raw import',
    }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.image_filename).toBe('20260528-image-a1b2c3d4.png')
    expect(saved[0]).toMatchObject({
      filePath,
      taskId: 'task-import',
      type: 'images',
      tool: 'bakin_exec_images_import',
    })
  })

  it('exports an asset to a surface profile using sharp', async () => {
    const sourceRel = 'assets/store/2026-05/20260528-source-a1b2c3d4.png'
    const sourceAbs = join(testDir, sourceRel)
    mkdirSync(join(testDir, 'assets', 'store', '2026-05'), { recursive: true })
    await sharp({ create: { width: 10, height: 10, channels: 3, background: '#00ff00' } }).png().toFile(sourceAbs)

    const { ctx, saved } = makeContext({
      assets: {
        save: mock(async (input: Record<string, unknown>) => {
          saved.push(input)
          return {
            ok: true,
            path: 'assets/store/2026-05/20260528-export-a1b2c3d4.jpg',
            metadataPath: 'assets/store/2026-05/20260528-export-a1b2c3d4.jpg.meta.json',
            filename: '20260528-export-a1b2c3d4.jpg',
          }
        }),
        getByFilename: mock(async () => ({
          filename: '20260528-source-a1b2c3d4.png',
          path: sourceRel,
          type: 'images',
          mimeType: 'image/png',
          size: 1,
          metadata: { agent: 'pixel', taskId: 'task-export', created: '2026-05-28T00:00:00Z' },
        })),
      } as never,
    })

    const result = await exportImage(ctx, {
      filename: '20260528-source-a1b2c3d4.png',
      taskId: 'task-export',
      surface: 'open-graph',
      format: 'jpg',
    }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result).toMatchObject({ image_filename: '20260528-export-a1b2c3d4.jpg', width: 1200, height: 630 })
    expect(saved[0]).toMatchObject({
      taskId: 'task-export',
      tool: 'bakin_exec_images_export',
      type: 'images',
    })
  })
})
