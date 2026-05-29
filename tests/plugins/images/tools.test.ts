import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import sharp from 'sharp'
import type { PluginContext } from '@bakin/core/plugin-types'
import { resetContentDir } from '../../../src/core/content-dir'

let testDir = join(tmpdir(), `bakin-images-tools-${Date.now()}`)

import { editImage, exportImage, generateImage, importImage } from '../../../plugins/images/lib/tools'

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

  it('generates through the runtime image capability and saves generation metadata', async () => {
    const runtimeFile = join(testDir, 'runtime-generated.png')
    writeFileSync(runtimeFile, 'runtime-image')
    const generate = mock(async () => ({
      provider: 'google',
      model: 'gemini-3.1-flash-image-preview',
      providerText: 'revised prompt',
      images: [{ filePath: runtimeFile, mimeType: 'image/png', width: 1080, height: 1920 }],
      metadata: { servedBy: 'runtime', credentialSource: 'runtime' },
    }))
    const { ctx, saved } = makeContext({
      runtime: { images: { providers: mock(async () => []), generate } } as never,
    })

    const result = await generateImage(ctx, {
      prompt: 'Golden hour smoothie',
      taskId: 'task-1',
      provider: 'google',
      model: 'gemini-3.1-flash-image-preview',
      surface: 'instagram-story',
    }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.image_filename).toBe('20260528-image-a1b2c3d4.png')
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'google',
      model: 'gemini-3.1-flash-image-preview',
      width: 1080,
      height: 1920,
    }))
    expect(result.routeSource).toBe('runtime')
    expect(saved[0]).toMatchObject({ filePath: runtimeFile })
    expect(saved[0].generation).toMatchObject({
      provider: 'google',
      model: 'gemini-3.1-flash-image-preview',
      surface: 'instagram-story',
      width: 1080,
      height: 1920,
      routeSource: 'runtime',
      createdByTool: 'bakin_exec_images_generate',
    })
  })

  it('records the shim serving path and credential source when the adapter gap-fills', async () => {
    const file = join(testDir, 'shim-generated.png')
    writeFileSync(file, 'shim-image')
    const generate = mock(async () => ({
      provider: 'openai',
      model: 'gpt-image-1.5',
      images: [{ filePath: file, mimeType: 'image/png', width: 1600, height: 900 }],
      metadata: { servedBy: 'shim', credentialSource: 'bakin-env' },
    }))
    const { ctx, saved } = makeContext({
      runtime: { images: { providers: mock(async () => []), generate } } as never,
    })

    const result = await generateImage(ctx, {
      prompt: 'Premium hero',
      taskId: 'task-shim',
      provider: 'openai',
      model: 'gpt-image-1.5',
      surface: 'blog-hero',
    }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.routeSource).toBe('shim')
    expect(result.credentialSource).toBe('bakin-env')
    expect(saved[0].generation).toMatchObject({ routeSource: 'shim' })
  })

  it('clamps oversized custom dimensions proportionally before generating', async () => {
    const file = join(testDir, 'big.png')
    writeFileSync(file, 'img')
    const generate = mock(async () => ({
      provider: 'google',
      model: 'gemini-3.1-flash-image-preview',
      images: [{ filePath: file, mimeType: 'image/png', width: 2048, height: 1024 }],
      metadata: { servedBy: 'runtime' },
    }))
    const { ctx } = makeContext({ runtime: { images: { providers: mock(async () => []), generate } } as never })

    await generateImage(ctx, {
      prompt: 'wide banner',
      taskId: 'task-clamp',
      provider: 'google',
      model: 'gemini-3.1-flash-image-preview',
      surface: 'custom',
      width: 4000,
      height: 2000,
    }, 'pixel')

    // 4000x2000 exceeds MAX_IMAGE_EDGE(2048) → scaled to 2048x1024, aspect kept.
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ width: 2048, height: 1024 }))
  })

  it('fails clearly when the active runtime has no image capability', async () => {
    const { ctx } = makeContext() // default ctx has no runtime.images

    const result = await generateImage(ctx, {
      prompt: 'x',
      taskId: 'task-none',
      provider: 'openai',
      model: 'gpt-image-2',
      surface: 'blog-hero',
    }, 'pixel')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/does not provide an image generation capability/i)
  })

  it('passes the resolved route and dimensions through to the runtime capability', async () => {
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

  it('edits an existing managed asset through the runtime edit capability', async () => {
    const sourceRel = 'assets/store/2026-05/20260529-src-a1b2c3d4.png'
    const sourceAbs = join(testDir, sourceRel)
    mkdirSync(dirname(sourceAbs), { recursive: true })
    writeFileSync(sourceAbs, 'src-bytes')
    const editedFile = join(testDir, 'edited.png')
    writeFileSync(editedFile, 'edited-bytes')

    const edit = mock(async () => ({
      provider: 'google',
      model: 'gemini-3.1-flash-image-preview',
      images: [{ filePath: editedFile, mimeType: 'image/png', width: 1080, height: 1080 }],
      metadata: { servedBy: 'runtime', credentialSource: 'runtime' },
    }))
    const editSaved: Array<Record<string, unknown>> = []
    const ctx = {
      getSettings: mock(() => ({})),
      assets: {
        save: mock(async (input: Record<string, unknown>) => {
          editSaved.push(input)
          return { ok: true, path: 'assets/store/2026-05/20260529-edit-b2c3.png', metadataPath: 'x.meta.json', filename: '20260529-edit-b2c3.png' }
        }),
        getByFilename: mock(async () => ({ filename: '20260529-src-a1b2c3d4.png', path: sourceRel, type: 'images', mimeType: 'image/png', size: 1, metadata: {} })),
      },
      runtime: { images: { providers: mock(async () => []), generate: mock(), edit } },
    } as unknown as PluginContext

    const result = await editImage(ctx, {
      prompt: 'add a capybara in the foreground',
      taskId: 'task-edit',
      filename: '20260529-src-a1b2c3d4.png',
      provider: 'google',
      model: 'gemini-3.1-flash-image-preview',
      surface: 'instagram-square',
    }, 'pixel')

    expect(result.ok).toBe(true)
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ files: [sourceAbs], provider: 'google' }))
    expect(editSaved[0]).toMatchObject({ tool: 'bakin_exec_images_edit' })
    expect(editSaved[0].generation).toMatchObject({ createdByTool: 'bakin_exec_images_edit', routeSource: 'runtime' })
  })

  it('fails an edit with no source image', async () => {
    const { ctx } = makeContext({ runtime: { images: { providers: mock(async () => []), generate: mock(), edit: mock() } } as never })
    const result = await editImage(ctx, { prompt: 'x', taskId: 't', provider: 'google', model: 'gemini-3.1-flash-image-preview' }, 'pixel')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/requires an existing source image/i)
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
