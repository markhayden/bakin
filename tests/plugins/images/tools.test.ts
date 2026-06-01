import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { createHash } from 'crypto'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { PluginContext } from '@bakin/core/plugin-types'
import { resetContentDir } from '../../../src/core/content-dir'

let testDir = join(tmpdir(), `bakin-images-tools-${Date.now()}`)

import { editImage, exportImage, generateImage, importImage } from '../../../plugins/images/lib/tools'
import { createAsset, addVersion } from '../../../plugins/assets/lib/asset-service'

const originalOpenAI = process.env.OPENAI_API_KEY
const originalGemini = process.env.GEMINI_API_KEY
const originalGoogle = process.env.GOOGLE_AI_API_KEY
const originalBakinHome = process.env.BAKIN_HOME

interface CreateCall { input: Record<string, unknown> }
interface VersionCall { assetId: string; input: Record<string, unknown> }
interface ExportCall { assetId: string; input: Record<string, unknown> }

function makeContext(overrides: Partial<PluginContext> = {}, sourceRef: { absPath: string; mimeType: string; version: number } | null = null) {
  const created: CreateCall['input'][] = []
  const versioned: VersionCall[] = []
  const exported: ExportCall[] = []
  const ctx = {
    getSettings: mock(() => ({})),
    assets: {
      createAsset: mock(async (input: Record<string, unknown>) => { created.push(input); return { assetId: '20260529-img-a1b2c3d4', version: 1 } }),
      addVersion: mock(async (assetId: string, input: Record<string, unknown>) => { versioned.push({ assetId, input }); return { assetId, version: 2 } }),
      addExport: mock(async (assetId: string, input: Record<string, unknown>) => { exported.push({ assetId, input }); return { name: input.surface as string, file: `exports/${input.surface}.${input.format}` } }),
      resolveVersionFile: mock(async () => sourceRef),
    },
    runtime: { config: { get: mock(async () => ({})) } },
    ...overrides,
  } as unknown as PluginContext
  return { ctx, created, versioned, exported }
}

function promptHash(prompt: string): string {
  return `sha256:${createHash('sha256').update(prompt).digest('hex')}`
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

  it('generates through the runtime, creating a new asset with generation provenance', async () => {
    const runtimeFile = join(testDir, 'runtime-generated.png')
    writeFileSync(runtimeFile, 'runtime-image')
    const generate = mock(async () => ({
      provider: 'google',
      model: 'gemini-3.1-flash-image-preview',
      providerText: 'revised prompt',
      images: [{ filePath: runtimeFile, mimeType: 'image/png', width: 1080, height: 1920 }],
      metadata: { servedBy: 'runtime', credentialSource: 'runtime' },
    }))
    const { ctx, created } = makeContext({ runtime: { images: { providers: mock(async () => []), generate } } as never })

    const result = await generateImage(ctx, {
      prompt: 'Golden hour smoothie', taskId: 'task-1', provider: 'google',
      model: 'gemini-3.1-flash-image-preview', surface: 'instagram-story',
    }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.assetId).toBe('20260529-img-a1b2c3d4')
    expect(result.version).toBe(1)
    expect(result.routeSource).toBe('runtime')
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google', model: 'gemini-3.1-flash-image-preview', width: 1080, height: 1920 }))
    expect(created[0]).toMatchObject({ sourceFilePath: runtimeFile, type: 'images', op: 'generate', tool: 'bakin_exec_images_generate' })
    expect(created[0].generation).toMatchObject({ provider: 'google', model: 'gemini-3.1-flash-image-preview', surface: 'instagram-story', routeSource: 'runtime' })
    expect((created[0].source as { kind: string }).kind).toBe('generated')
  })

  it('records the shim serving path and credential source when the adapter gap-fills', async () => {
    const file = join(testDir, 'shim-generated.png')
    writeFileSync(file, 'shim-image')
    const generate = mock(async () => ({
      provider: 'openai', model: 'gpt-image-1.5',
      images: [{ filePath: file, mimeType: 'image/png', width: 1600, height: 900 }],
      metadata: { servedBy: 'shim', credentialSource: 'bakin-env' },
    }))
    const { ctx, created } = makeContext({ runtime: { images: { providers: mock(async () => []), generate } } as never })

    const result = await generateImage(ctx, { prompt: 'Premium hero', taskId: 'task-shim', provider: 'openai', model: 'gpt-image-1.5', surface: 'blog-hero' }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.routeSource).toBe('shim')
    expect(result.credentialSource).toBe('bakin-env')
    expect(created[0].generation).toMatchObject({ routeSource: 'shim' })
  })

  it('clamps oversized custom dimensions proportionally before generating', async () => {
    const file = join(testDir, 'big.png')
    writeFileSync(file, 'img')
    const generate = mock(async () => ({
      provider: 'google', model: 'gemini-3.1-flash-image-preview',
      images: [{ filePath: file, mimeType: 'image/png', width: 2048, height: 1024 }],
      metadata: { servedBy: 'runtime' },
    }))
    const { ctx } = makeContext({ runtime: { images: { providers: mock(async () => []), generate } } as never })

    await generateImage(ctx, { prompt: 'wide banner', taskId: 'task-clamp', provider: 'google', model: 'gemini-3.1-flash-image-preview', surface: 'custom', width: 4000, height: 2000 }, 'pixel')

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ width: 2048, height: 1024 }))
  })

  it('reuses an already-saved generated asset for an identical retry before calling the provider', async () => {
    const prompt = 'A charming cartoon piglet in a space suit, ready for launch.'
    const file = join(testDir, 'already-generated.png')
    writeFileSync(file, 'img')
    const existing = await createAsset({
      sourceFilePath: file,
      type: 'images',
      agent: 'pixel',
      taskId: 'task-retry',
      slug: 'instagram-feed-portrait-image',
      op: 'generate',
      tool: 'bakin_exec_images_generate',
      prompt,
      promptHash: promptHash(prompt),
      description: prompt,
      tags: ['generated', 'instagram-feed-portrait', 'openai', 'gpt-image-2'],
      source: { kind: 'generated', path: null },
      generation: {
        provider: 'openai',
        model: 'gpt-image-2',
        surface: 'instagram-feed-portrait',
        quality: 'standard',
        routeSource: 'runtime',
      },
    })
    const generate = mock(async () => { throw new Error('provider should not be called') })
    const { ctx } = makeContext({ runtime: { images: { providers: mock(async () => []), generate } } as never })

    const result = await generateImage(ctx, {
      prompt,
      taskId: 'task-retry',
      provider: 'openai',
      model: 'gpt-image-2',
      surface: 'instagram-feed-portrait',
      quality: 'standard',
    }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.assetId).toBe(existing.assetId)
    expect(result.reused).toBe(true)
    expect(result.idempotency).toBe('asset')
    expect(generate).not.toHaveBeenCalled()
  })

  it('fails clearly when the active runtime has no image capability', async () => {
    const { ctx } = makeContext()
    const result = await generateImage(ctx, { prompt: 'x', taskId: 'task-none', provider: 'openai', model: 'gpt-image-2', surface: 'blog-hero' }, 'pixel')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/does not provide an image generation capability/i)
  })

  it('passes the resolved route and dimensions through to the runtime capability (no direct fetch)', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('direct fetch should not be called'))
    const runtimeFile = join(testDir, 'runtime-generated.png')
    writeFileSync(runtimeFile, 'runtime-image')
    const runtimeGenerate = mock(async () => ({
      provider: 'openai', model: 'gpt-image-2', providerText: 'runtime revised prompt',
      images: [{ filePath: runtimeFile, mimeType: 'image/png', width: 1024, height: 1024 }],
    }))
    const { ctx, created } = makeContext({
      runtime: {
        images: {
          providers: mock(async () => [{ id: 'openai', label: 'OpenAI', configured: true, defaultModel: 'gpt-image-2', models: ['gpt-image-2'], capabilities: { generate: { maxCount: 4, supportsSize: true } } }]),
          generate: runtimeGenerate,
        },
        config: { get: mock(async () => ({})) },
      } as never,
    })

    const result = await generateImage(ctx, { prompt: 'Codex-routed test image', taskId: 'task-runtime', provider: 'openai', model: 'gpt-image-2', surface: 'blog-hero' }, 'pixel')

    expect(result.ok).toBe(true)
    expect(runtimeGenerate).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai', model: 'gpt-image-2', width: 1600, height: 900 }))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(created[0].generation).toMatchObject({ provider: 'openai', model: 'gpt-image-2', routeSource: 'runtime' })
  })

  it('edits a managed asset by assetId, appending a new version', async () => {
    const sourceAbs = join(testDir, 'source-current.png')
    writeFileSync(sourceAbs, 'src-bytes')
    const editedFile = join(testDir, 'edited.png')
    writeFileSync(editedFile, 'edited-bytes')

    const edit = mock(async () => ({
      provider: 'google', model: 'gemini-3.1-flash-image-preview',
      images: [{ filePath: editedFile, mimeType: 'image/png', width: 1080, height: 1080 }],
      metadata: { servedBy: 'runtime', credentialSource: 'runtime' },
    }))
    const { ctx, versioned } = makeContext(
      { runtime: { images: { providers: mock(async () => []), generate: mock(), edit } } as never },
      { absPath: sourceAbs, mimeType: 'image/png', version: 3 },
    )

    const result = await editImage(ctx, { prompt: 'add a capybara in the foreground', taskId: 'task-edit', assetId: '20260529-src-a1b2c3d4', provider: 'google', model: 'gemini-3.1-flash-image-preview', surface: 'instagram-square' }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.assetId).toBe('20260529-src-a1b2c3d4')
    expect(result.version).toBe(2)
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ files: [sourceAbs], provider: 'google' }))
    expect(versioned[0]).toMatchObject({ assetId: '20260529-src-a1b2c3d4' })
    expect(versioned[0].input).toMatchObject({ sourceFilePath: editedFile, op: 'edit', tool: 'bakin_exec_images_edit' })
    expect(versioned[0].input.generation).toMatchObject({ routeSource: 'runtime' })
  })

  it('reuses the current edited version for an identical edit retry', async () => {
    const sourceAbs = join(testDir, 'source-existing.png')
    const editedAbs = join(testDir, 'edited-existing.png')
    writeFileSync(sourceAbs, 'src-bytes')
    writeFileSync(editedAbs, 'edited-bytes')
    const prompt = 'add a small rocket backpack'
    const created = await createAsset({
      sourceFilePath: sourceAbs,
      type: 'images',
      agent: 'pixel',
      taskId: 'task-edit-retry',
      slug: 'edit-source',
      op: 'import',
    })
    await addVersion(created.assetId, {
      sourceFilePath: editedAbs,
      op: 'edit',
      tool: 'bakin_exec_images_edit',
      prompt,
      promptHash: promptHash(prompt),
      description: prompt,
      tags: ['edited', 'instagram-square', 'google', 'gemini-3.1-flash-image-preview'],
      generation: {
        provider: 'google',
        model: 'gemini-3.1-flash-image-preview',
        surface: 'instagram-square',
        quality: 'standard',
        routeSource: 'runtime',
      },
    })
    const edit = mock(async () => { throw new Error('provider should not be called') })
    const { ctx } = makeContext(
      { runtime: { images: { providers: mock(async () => []), generate: mock(), edit } } as never },
      { absPath: editedAbs, mimeType: 'image/png', version: 2 },
    )

    const result = await editImage(ctx, {
      prompt,
      taskId: 'task-edit-retry',
      assetId: created.assetId,
      provider: 'google',
      model: 'gemini-3.1-flash-image-preview',
      surface: 'instagram-square',
    }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.assetId).toBe(created.assetId)
    expect(result.version).toBe(2)
    expect(result.reused).toBe(true)
    expect(edit).not.toHaveBeenCalled()
  })

  it('fails an edit when the source asset is not found', async () => {
    const { ctx } = makeContext({ runtime: { images: { providers: mock(async () => []), generate: mock(), edit: mock() } } as never }, null)
    const result = await editImage(ctx, { prompt: 'x', taskId: 't', assetId: '20260529-missing-deadbeef', provider: 'google', model: 'gemini-3.1-flash-image-preview' }, 'pixel')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/i)
  })

  it('imports a local image file as a new asset', async () => {
    const filePath = join(testDir, 'raw.jpg')
    writeFileSync(filePath, 'not-really-an-image')
    const { ctx, created } = makeContext()

    const result = await importImage(ctx, { filePath, taskId: 'task-import', description: 'Raw import' }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.assetId).toBe('20260529-img-a1b2c3d4')
    expect(created[0]).toMatchObject({ sourceFilePath: filePath, taskId: 'task-import', type: 'images', op: 'import', tool: 'bakin_exec_images_import' })
  })

  it('exports an asset to a surface profile (attached export)', async () => {
    const { ctx, exported } = makeContext()

    const result = await exportImage(ctx, { assetId: '20260528-source-a1b2c3d4', taskId: 'task-export', surface: 'open-graph', format: 'jpg' }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result).toMatchObject({ assetId: '20260528-source-a1b2c3d4', exportName: 'open-graph', width: 1200, height: 630, format: 'jpg' })
    expect(exported[0]).toMatchObject({ assetId: '20260528-source-a1b2c3d4' })
    expect(exported[0].input).toMatchObject({ surface: 'open-graph', format: 'jpg', width: 1200, height: 630 })
  })
})
