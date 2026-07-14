import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { createHash } from 'crypto'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { PluginContext } from '@bakin/core/plugin-types'
import { resetContentDir } from '../../../src/core/content-dir'

let testDir = join(tmpdir(), `bakin-images-tools-${Date.now()}`)

import { editImage, exportImage, generateImage, importImage } from '../../../plugins/images/lib/tools'
import {
  createAsset,
  addVersion,
  getAsset as realGetAsset,
  getAssetSummary as realGetAssetSummary,
  listAssets as realListAssets,
  upsertFromSource as realUpsertFromSource,
  resolveStoreFile as realResolveStoreFile,
} from '../../../plugins/assets/lib/asset-service'

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
    // Billable tools refuse when the referenced task is gone (deleted mid-run
    // second line of defense); default stub: task exists.
    tasks: { get: mock(async (id: string) => ({ id })) },
    assets: {
      createAsset: mock(async (input: Record<string, unknown>) => { created.push(input); return { assetId: '20260529-img-a1b2c3d4', version: 1 } }),
      addVersion: mock(async (assetId: string, input: Record<string, unknown>) => { versioned.push({ assetId, input }); return { assetId, version: 2 } }),
      addExport: mock(async (assetId: string, input: Record<string, unknown>) => { exported.push({ assetId, input }); return { name: input.surface as string, file: `exports/${input.surface}.${input.format}` } }),
      resolveVersionFile: mock(async () => sourceRef),
      // Read paths delegate to the REAL asset service against the temp
      // BAKIN_HOME — the same store the tests seed with createAsset/addVersion
      // (tools.ts used to import these directly; it now goes through ctx.assets).
      getAsset: mock(async (assetId: string) => realGetAssetSummary(assetId)),
      listAssets: mock(async (filter?: { type?: 'images'; taskId?: string }) => realListAssets(filter)),
      getAssetVersions: mock(async (assetId: string) => {
        const manifest = realGetAsset(assetId)
        return manifest ? { currentVersion: manifest.currentVersion, versions: manifest.versions } : null
      }),
      upsertFromSource: mock(realUpsertFromSource),
      resolveStoreFile: mock(async (absPath: string) => realResolveStoreFile(absPath)),
    },
    ...overrides,
    // Merge (not replace) the runtime so per-test images/messaging overrides
    // keep the capability descriptor the P4.1 gate reads.
    runtime: {
      config: { get: mock(async () => ({})) },
      capabilities: mock(async () => ({ imageGen: { mode: 'native' } })),
      ...((overrides as { runtime?: Record<string, unknown> }).runtime ?? {}),
    },
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

  it('refuses billable generation when the task was deleted — before any billing', async () => {
    const generate = mock(async () => { throw new Error('must never be called') })
    const { ctx } = makeContext({
      tasks: { get: mock(async () => null) } as never,
      runtime: { images: { providers: mock(async () => []), generate } } as never,
    })
    const result = await generateImage(ctx, { prompt: 'x', taskId: 'task-deleted-1', surface: 'blog-hero' }, 'pixel')
    expect(result.error ?? '').toContain('no longer exists')
    expect(generate).toHaveBeenCalledTimes(0)
  })

  it("fails honestly when the runtime reports imageGen 'unavailable' — before any route math (P4.1)", async () => {
    const generate = mock(async () => { throw new Error('must never be called') })
    const { ctx, created } = makeContext({
      runtime: {
        images: { providers: mock(async () => []), generate },
        capabilities: mock(async () => ({ imageGen: { mode: 'unavailable' } })),
      } as never,
    })

    const result = await generateImage(ctx, { prompt: 'x', taskId: 't', surface: 'instagram-story' }, 'pixel')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('unavailable on this runtime')
    expect(generate).not.toHaveBeenCalled()
    expect(created).toEqual([])
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
    // Native path has no quality knob — don't record a tier it never applied (#379).
    expect((created[0].generation as Record<string, unknown>).quality).toBeUndefined()
    expect((created[0].source as { kind: string }).kind).toBe('generated')
    // No machine tags: provenance lives in generation/op, tags are the user's namespace.
    expect(created[0].tags).toBeUndefined()
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

    const result = await generateImage(ctx, { prompt: 'Premium hero', taskId: 'task-shim', provider: 'openai', model: 'gpt-image-1.5', surface: 'blog-hero', quality: 'premium' }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.routeSource).toBe('shim')
    expect(result.credentialSource).toBe('bakin-env')
    expect(created[0].generation).toMatchObject({ routeSource: 'shim' })
    // Shim path honors quality, so it IS recorded (#379).
    expect((created[0].generation as Record<string, unknown>).quality).toBe('premium')
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

  it('reuses a native generated asset that recorded no quality, on an identical retry (#379)', async () => {
    const prompt = 'A lighthouse at dusk, long exposure.'
    const file = join(testDir, 'native-generated.png')
    writeFileSync(file, 'img')
    const existing = await createAsset({
      sourceFilePath: file, type: 'images', agent: 'pixel', taskId: 'task-native-retry',
      slug: 'instagram-feed-portrait-image', op: 'generate', tool: 'bakin_exec_images_generate',
      prompt, promptHash: promptHash(prompt), description: prompt,
      source: { kind: 'generated', path: null },
      // Native generation: quality deliberately absent (the runtime never applied one).
      generation: { provider: 'openai', model: 'gpt-image-2', surface: 'instagram-feed-portrait', routeSource: 'runtime' },
    })
    const generate = mock(async () => { throw new Error('provider should not be called') })
    const { ctx } = makeContext({ runtime: { images: { providers: mock(async () => []), generate } } as never })

    // The retry still carries a quality tier (from settings/default); the
    // reuse-match must treat the stored asset's missing quality as native-normal.
    const result = await generateImage(ctx, {
      prompt, taskId: 'task-native-retry', provider: 'openai', model: 'gpt-image-2',
      surface: 'instagram-feed-portrait', quality: 'premium',
    }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.assetId).toBe(existing.assetId)
    expect(result.reused).toBe(true)
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
    // Version inputs carry no tags — versioning never touches the asset's tag namespace.
    expect('tags' in versioned[0].input).toBe(false)
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
    // No 'imported' machine-tag default — op/source already record provenance.
    expect(created[0].tags).toBeUndefined()
  })

  it('exports an asset to a surface profile (attached export)', async () => {
    const { ctx, exported } = makeContext()

    const result = await exportImage(ctx, { assetId: '20260528-source-a1b2c3d4', taskId: 'task-export', surface: 'open-graph', format: 'jpg' }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result).toMatchObject({ assetId: '20260528-source-a1b2c3d4', exportName: 'open-graph', width: 1200, height: 630, format: 'jpg' })
    expect(exported[0]).toMatchObject({ assetId: '20260528-source-a1b2c3d4' })
    expect(exported[0].input).toMatchObject({ surface: 'open-graph', format: 'jpg', width: 1200, height: 630 })
  })

  describe('brand-conditioned generation (#419)', () => {
    const runtimeProvider = () => mock(async () => [
      { id: 'openai', label: 'OpenAI', configured: true, selected: true, defaultModel: 'gpt-image-2', models: ['gpt-image-2'] },
    ])
    const acmeBrand = (overrides: Record<string, unknown> = {}) => ({
      manifest: {
        id: 'acme',
        name: 'Acme',
        description: 'Warm bakery software.',
        palette: [{ name: 'ink', hex: '#1A1A2E', usage: 'primary' }],
        ...overrides,
      },
      fingerprint: 'sha256:brandfp1',
    })
    const hooksWith = (result: unknown) => ({
      has: (name: string) => name === 'brands.get',
      invoke: mock(async () => result),
      register: mock(),
      call: mock(),
      callAll: mock(),
    })

    it('merges palette into the prompt, fills default references, records provenance', async () => {
      const outFile = join(testDir, 'brand-generated.png')
      writeFileSync(outFile, 'img')
      const refAbs = join(testDir, 'brand-logo.png')
      writeFileSync(refAbs, 'logo')
      const generate = mock(async () => ({
        provider: 'openai', model: 'gpt-image-2',
        images: [{ filePath: outFile, mimeType: 'image/png', width: 1024, height: 1024 }],
        metadata: { servedBy: 'runtime' },
      }))
      const refId = '20260601-logo-ccccdddd'
      const { ctx, created } = makeContext(
        {
          runtime: { images: { providers: runtimeProvider(), generate } },
          hooks: hooksWith(acmeBrand({ defaultImageReferences: [refId] })),
        } as never,
        { absPath: refAbs, mimeType: 'image/png', version: 1 },
      )

      const result = await generateImage(ctx, {
        prompt: 'launch hero image', taskId: 'task-brand', provider: 'openai',
        model: 'gpt-image-2', surface: 'instagram-feed-portrait', brandId: 'acme',
      }, 'pixel')

      expect(result.ok).toBe(true)
      // Palette merged into the provider prompt
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({
        prompt: expect.stringContaining('#1A1A2E'),
      }))
      // Brand default references filled the empty slots
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: [refAbs] }))
      // Provenance: brandId + content fingerprint (the V2 staleness hook)
      expect(created[0].generation).toMatchObject({ brandId: 'acme', brandFingerprint: 'sha256:brandfp1' })
    })

    it('hard-errors on unknown and draft brands BEFORE any provider call', async () => {
      const generate = mock(async () => ({ provider: 'openai', model: 'gpt-image-2', images: [] }))
      const { ctx } = makeContext({
        runtime: { images: { providers: runtimeProvider(), generate } },
        hooks: hooksWith(undefined),
      } as never)
      const missing = await generateImage(ctx, {
        prompt: 'x', taskId: 't', provider: 'openai', model: 'gpt-image-2', brandId: 'ghost',
      }, 'pixel')
      expect(missing.ok).toBe(false)
      expect(String(missing.error)).toContain('ghost')
      expect(generate).not.toHaveBeenCalled()

      const { ctx: draftCtx } = makeContext({
        runtime: { images: { providers: runtimeProvider(), generate } },
        hooks: hooksWith(acmeBrand({ draft: true })),
      } as never)
      const draft = await generateImage(draftCtx, {
        prompt: 'x', taskId: 't', provider: 'openai', model: 'gpt-image-2', brandId: 'acme',
      }, 'pixel')
      expect(draft.ok).toBe(false)
      expect(String(draft.error)).toContain('draft')
      expect(generate).not.toHaveBeenCalled()
    })

    it('agent-passed references win over brand defaults', async () => {
      const outFile = join(testDir, 'brand-agent-ref.png')
      writeFileSync(outFile, 'img')
      const agentRefAbs = join(testDir, 'agent-shot.png')
      writeFileSync(agentRefAbs, 'shot')
      const generate = mock(async () => ({
        provider: 'openai', model: 'gpt-image-2',
        images: [{ filePath: outFile, mimeType: 'image/png', width: 1024, height: 1024 }],
        metadata: { servedBy: 'runtime' },
      }))
      const { ctx } = makeContext(
        {
          runtime: { images: { providers: runtimeProvider(), generate } },
          hooks: hooksWith(acmeBrand({ defaultImageReferences: ['20260601-logo-eeeeffff'] })),
        } as never,
        { absPath: agentRefAbs, mimeType: 'image/png', version: 2 },
      )

      const result = await generateImage(ctx, {
        prompt: 'hero', taskId: 't', provider: 'openai', model: 'gpt-image-2',
        surface: 'instagram-feed-portrait', brandId: 'acme',
        referenceImages: ['20260601-shot-11112222'],
      }, 'pixel')
      expect(result.ok).toBe(true)
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: [agentRefAbs] }))
    })
  })

  describe('reference images (#418)', () => {
    // A runtime-configured provider yields servedBy: 'runtime' so the native
    // reference path is exercised (the default harness has no runtime provider →
    // servedBy 'shim', which references are not allowed on).
    const runtimeProvider = () => mock(async () => [
      { id: 'openai', label: 'OpenAI', configured: true, selected: true, defaultModel: 'gpt-image-2', models: ['gpt-image-2'] },
    ])

    it('generates conditioned on a reference asset and records lineage', async () => {
      const outFile = join(testDir, 'ref-generated.png')
      writeFileSync(outFile, 'img')
      const refAbs = join(testDir, 'horse.png')
      writeFileSync(refAbs, 'horse')
      const generate = mock(async () => ({
        provider: 'openai', model: 'gpt-image-2',
        images: [{ filePath: outFile, mimeType: 'image/png', width: 1024, height: 1024 }],
        metadata: { servedBy: 'runtime' },
      }))
      const { ctx, created } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), generate } } } as never,
        { absPath: refAbs, mimeType: 'image/png', version: 3 },
      )
      const refId = '20260601-horse-aaaabbbb'

      const result = await generateImage(ctx, {
        prompt: 'a charming horse in space', taskId: 'task-ref', provider: 'openai',
        model: 'gpt-image-2', surface: 'instagram-feed-portrait', referenceImages: [refId],
      }, 'pixel')

      expect(result.ok).toBe(true)
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: [refAbs] }))
      expect(created[0].generation).toMatchObject({ references: [{ assetId: refId, version: 3 }] })
    })

    it('auto-imports a raw-path reference into a managed asset', async () => {
      const outFile = join(testDir, 'gen.png')
      writeFileSync(outFile, 'img')
      const refPath = join(testDir, 'loose-logo.png')
      writeFileSync(refPath, 'logo-bytes')
      const generate = mock(async () => ({
        provider: 'openai', model: 'gpt-image-2',
        images: [{ filePath: outFile, mimeType: 'image/png', width: 1024, height: 1024 }],
        metadata: { servedBy: 'runtime' },
      }))
      const { ctx, created } = makeContext({ runtime: { images: { providers: runtimeProvider(), generate } } } as never, null)

      const result = await generateImage(ctx, {
        prompt: 'brand thing', taskId: 'task-import', provider: 'openai',
        model: 'gpt-image-2', surface: 'instagram-feed-portrait', referenceImages: [refPath],
      }, 'pixel')

      expect(result.ok).toBe(true)
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: [refPath] }))
      const refs = (created[0].generation as { references?: Array<{ assetId: string }> }).references
      expect(refs).toHaveLength(1)
      expect(refs![0].assetId).toMatch(/^\d{8}-/) // a freshly minted managed assetId
      // Auto-imported references are tagged so the assets view can filter them
      // out from deliverables.
      const { getAsset } = await import('../../../plugins/assets/lib/asset-service')
      expect(getAsset(refs![0].assetId)?.tags).toContain('reference')
    })

    it('accepts references on the shim path — the direct shim takes input images (WS3)', async () => {
      const outFile = join(testDir, 'shimref-out.png')
      writeFileSync(outFile, 'png')
      const generate = mock(async () => ({ images: [{ filePath: outFile, mimeType: 'image/png', width: 1024, height: 1024 }] }))
      const { ctx } = makeContext(
        { runtime: { images: { providers: mock(async () => []), generate } } } as never,
        { absPath: join(testDir, 'x.png'), mimeType: 'image/png', version: 1 },
      )
      const result = await generateImage(ctx, {
        prompt: 'x', taskId: 'task-shimref', provider: 'openai', model: 'gpt-image-2',
        surface: 'instagram-feed-portrait', referenceImages: ['20260601-horse-aaaabbbb'],
      }, 'pixel')

      expect(result.ok).toBe(true)
      // The reference id must have resolved to the asset's ACTUAL version
      // file — the shim path gets real absolute paths, same as native.
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({
        referenceImages: [join(testDir, 'x.png')],
      }))
    })

    it('rejects references when the model lacks the reference-images capability', async () => {
      // A runtime-only provider/model synthesizes capabilities without reference-images.
      const providers = mock(async () => [
        { id: 'replicate', label: 'Replicate', configured: true, selected: true, defaultModel: 'flux', models: ['flux'] },
      ])
      const generate = mock(async () => { throw new Error('should not bill') })
      const { ctx } = makeContext(
        { runtime: { images: { providers, generate } } } as never,
        { absPath: join(testDir, 'x.png'), mimeType: 'image/png', version: 1 },
      )
      const result = await generateImage(ctx, {
        prompt: 'x', taskId: 'task-cap', provider: 'replicate', model: 'flux',
        surface: 'instagram-feed-portrait', referenceImages: ['20260601-horse-aaaabbbb'],
      }, 'pixel')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/does not support reference images/i)
      expect(generate).not.toHaveBeenCalled()
    })

    it('rejects more than the max reference images, before billing', async () => {
      const generate = mock(async () => { throw new Error('should not bill') })
      const { ctx } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), generate } } } as never,
        { absPath: join(testDir, 'x.png'), mimeType: 'image/png', version: 1 },
      )
      const refs = [1, 2, 3, 4, 5].map(n => `2026060${n}-ref-aaaabbbb`)
      const result = await generateImage(ctx, {
        prompt: 'x', taskId: 'task-cap2', provider: 'openai', model: 'gpt-image-2',
        surface: 'instagram-feed-portrait', referenceImages: refs,
      }, 'pixel')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/too many reference images/i)
      expect(generate).not.toHaveBeenCalled()
    })

    it('appends references after the base file on edit', async () => {
      const outFile = join(testDir, 'edited.png')
      writeFileSync(outFile, 'img')
      const baseAbs = join(testDir, 'base.png')
      writeFileSync(baseAbs, 'base')
      const refAbs = join(testDir, 'ref.png')
      writeFileSync(refAbs, 'ref')
      const edit = mock(async () => ({
        provider: 'openai', model: 'gpt-image-2',
        images: [{ filePath: outFile, mimeType: 'image/png', width: 1024, height: 1024 }],
        metadata: { servedBy: 'runtime' },
      }))
      // resolveVersionFile is called for both the base asset AND the reference
      // assetId; the mock returns the same ref, so assert the base path comes first.
      const { ctx } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), edit } } } as never,
        { absPath: baseAbs, mimeType: 'image/png', version: 1 },
      )

      const result = await editImage(ctx, {
        assetId: '20260601-logo-aaaabbbb', prompt: 'match this', taskId: 'task-edit-ref',
        provider: 'openai', model: 'gpt-image-2', surface: 'instagram-feed-portrait',
        referenceImages: ['20260601-swatch-ccccdddd'],
      }, 'pixel')

      expect(result.ok).toBe(true)
      const editArgs = (edit.mock.calls[0] as unknown[])[0] as { files: string[] }
      expect(editArgs.files[0]).toBe(baseAbs) // base stays first
      expect(editArgs.files).toHaveLength(2)
    })

    it('versionOf appends the render as a new version of an existing asset (op: generate)', async () => {
      const outFile = join(testDir, 'reroll.png')
      writeFileSync(outFile, 'img')
      const baseAbs = join(testDir, 'pass1.png')
      writeFileSync(baseAbs, 'pass1')
      const { createAsset } = await import('../../../plugins/assets/lib/asset-service')
      const target = await createAsset({
        sourceFilePath: baseAbs, type: 'images', agent: 'pixel', taskId: 'task-reroll',
        slug: 'horse-image', op: 'generate', tool: 'bakin_exec_images_generate',
        description: 'first pass', source: { kind: 'generated', path: null },
      })
      const generate = mock(async () => ({
        provider: 'openai', model: 'gpt-image-2',
        images: [{ filePath: outFile, mimeType: 'image/png', width: 1024, height: 1024 }],
        metadata: { servedBy: 'runtime' },
      }))
      const { ctx, created, versioned } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), generate } } } as never,
        { absPath: baseAbs, mimeType: 'image/png', version: 1 },
      )

      const result = await generateImage(ctx, {
        prompt: 'clearer side profile, same dusty world', taskId: 'task-reroll',
        provider: 'openai', model: 'gpt-image-2', surface: 'instagram-feed-portrait',
        versionOf: target.assetId,
      }, 'pixel')

      expect(result.ok).toBe(true)
      expect(result.version).toBe(2)
      expect(created).toHaveLength(0)
      expect(versioned).toHaveLength(1)
      expect(versioned[0].assetId).toBe(target.assetId)
      expect(versioned[0].input.op).toBe('generate')
    })

    it('versionOf must target an images asset, before billing', async () => {
      const notePath = join(testDir, 'note.md')
      writeFileSync(notePath, '# notes')
      const { createAsset } = await import('../../../plugins/assets/lib/asset-service')
      const textAsset = await createAsset({
        sourceFilePath: notePath, type: 'text', agent: 'pixel', taskId: 'task-type',
        slug: 'notes', op: 'upload', description: 'notes',
      })
      const generate = mock(async () => { throw new Error('should not bill') })
      const { ctx } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), generate } } } as never,
        { absPath: notePath, mimeType: 'text/markdown', version: 1 },
      )

      const result = await generateImage(ctx, {
        prompt: 'x', taskId: 'task-type', provider: 'openai', model: 'gpt-image-2',
        surface: 'instagram-feed-portrait', versionOf: textAsset.assetId,
      }, 'pixel')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/versionOf must target an images asset/i)
      expect(generate).not.toHaveBeenCalled()
    })

    it('rejects the contradictory versionOf + allowNewAsset combination', async () => {
      const generate = mock(async () => { throw new Error('should not bill') })
      const { ctx } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), generate } } } as never,
        null,
      )

      const result = await generateImage(ctx, {
        prompt: 'x', taskId: 'task-contradict', provider: 'openai', model: 'gpt-image-2',
        surface: 'instagram-feed-portrait', versionOf: '20260601-h-aaaabbbb', allowNewAsset: true,
      }, 'pixel')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/versionOf and allowNewAsset/i)
      expect(generate).not.toHaveBeenCalled()
    })

    it('versionOf is never hijacked by a matching SIBLING asset in the reuse check', async () => {
      // A sibling on the same task whose current version matches the request
      // must not swallow an explicit versionOf re-roll as "reused".
      const prompt = 'identical prompt for both'
      const siblingFile = join(testDir, 'sibling.png')
      writeFileSync(siblingFile, 'sibling')
      const targetFile = join(testDir, 'target.png')
      writeFileSync(targetFile, 'target')
      const { createAsset } = await import('../../../plugins/assets/lib/asset-service')
      const sibling = await createAsset({
        sourceFilePath: siblingFile, type: 'images', agent: 'pixel', taskId: 'task-hijack',
        slug: 'sibling', op: 'generate', tool: 'bakin_exec_images_generate',
        prompt, promptHash: promptHash(prompt), description: 'sibling',
        source: { kind: 'generated', path: null },
        generation: { provider: 'openai', model: 'gpt-image-2', surface: 'instagram-feed-portrait', routeSource: 'runtime' },
      })
      const target = await createAsset({
        sourceFilePath: targetFile, type: 'images', agent: 'pixel', taskId: 'task-hijack',
        slug: 'target', op: 'generate', tool: 'bakin_exec_images_generate',
        description: 'target', source: { kind: 'generated', path: null },
      })
      const outFile = join(testDir, 'hijack-out.png')
      writeFileSync(outFile, 'render')
      const generate = mock(async () => ({
        provider: 'openai', model: 'gpt-image-2',
        images: [{ filePath: outFile, mimeType: 'image/png', width: 1024, height: 1024 }],
        metadata: { servedBy: 'runtime' },
      }))
      const { ctx, versioned } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), generate } } } as never,
        { absPath: targetFile, mimeType: 'image/png', version: 1 },
      )

      const result = await generateImage(ctx, {
        prompt, taskId: 'task-hijack', provider: 'openai', model: 'gpt-image-2',
        surface: 'instagram-feed-portrait', versionOf: target.assetId,
      }, 'pixel')

      expect(result.ok).toBe(true)
      expect(result.assetId).not.toBe(sibling.assetId)
      expect(versioned).toHaveLength(1)
      expect(versioned[0].assetId).toBe(target.assetId)
    })

    it('versionOf fails cleanly when the target asset does not exist, before billing', async () => {
      const generate = mock(async () => { throw new Error('should not bill') })
      const { ctx } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), generate } } } as never,
        null,
      )

      const result = await generateImage(ctx, {
        prompt: 'x', taskId: 'task-reroll-missing', provider: 'openai', model: 'gpt-image-2',
        surface: 'instagram-feed-portrait', versionOf: '20260601-ghost-aaaabbbb',
      }, 'pixel')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/versionOf asset not found/i)
      expect(generate).not.toHaveBeenCalled()
    })

    it('refuses generate referencing the agent OWN same-task output without versionOf — the iteration trap', async () => {
      // Seed a REAL generated asset on this task (pixel's first pass).
      const passFile = join(testDir, 'first-pass.png')
      writeFileSync(passFile, 'first-pass')
      const { createAsset } = await import('../../../plugins/assets/lib/asset-service')
      const firstPass = await createAsset({
        sourceFilePath: passFile, type: 'images', agent: 'pixel', taskId: 'task-iter',
        slug: 'horse-image', op: 'generate', tool: 'bakin_exec_images_generate',
        description: 'first pass', source: { kind: 'generated', path: null },
      })

      const generate = mock(async () => { throw new Error('should not bill') })
      const { ctx } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), generate } } } as never,
        { absPath: passFile, mimeType: 'image/png', version: 1 },
      )

      const result = await generateImage(ctx, {
        prompt: 'correction pass: clearer side profile', taskId: 'task-iter',
        provider: 'openai', model: 'gpt-image-2', surface: 'instagram-feed-portrait',
        referenceImages: [firstPass.assetId],
      }, 'pixel')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/your own output on this task/i)
      expect(result.error).toContain('versionOf')
      expect(result.error).toContain('allowNewAsset')
      expect(generate).not.toHaveBeenCalled()
    })

    it('allows the iteration when versionOf targets the referenced first pass', async () => {
      const passFile = join(testDir, 'first-pass-v.png')
      writeFileSync(passFile, 'first-pass')
      const { createAsset } = await import('../../../plugins/assets/lib/asset-service')
      const firstPass = await createAsset({
        sourceFilePath: passFile, type: 'images', agent: 'pixel', taskId: 'task-iter2',
        slug: 'horse-image', op: 'generate', tool: 'bakin_exec_images_generate',
        description: 'first pass', source: { kind: 'generated', path: null },
      })
      const outFile = join(testDir, 'second-pass.png')
      writeFileSync(outFile, 'second')
      const generate = mock(async () => ({
        provider: 'openai', model: 'gpt-image-2',
        images: [{ filePath: outFile, mimeType: 'image/png', width: 1024, height: 1024 }],
        metadata: { servedBy: 'runtime' },
      }))
      const { ctx, versioned } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), generate } } } as never,
        { absPath: passFile, mimeType: 'image/png', version: 1 },
      )

      const result = await generateImage(ctx, {
        prompt: 'correction pass', taskId: 'task-iter2', provider: 'openai',
        model: 'gpt-image-2', surface: 'instagram-feed-portrait',
        referenceImages: [firstPass.assetId], versionOf: firstPass.assetId,
      }, 'pixel')

      expect(result.ok).toBe(true)
      expect(versioned).toHaveLength(1)
      expect(versioned[0].assetId).toBe(firstPass.assetId)
    })

    it('allows a deliberate companion image via allowNewAsset', async () => {
      const passFile = join(testDir, 'first-pass-c.png')
      writeFileSync(passFile, 'first-pass')
      const { createAsset } = await import('../../../plugins/assets/lib/asset-service')
      const firstPass = await createAsset({
        sourceFilePath: passFile, type: 'images', agent: 'pixel', taskId: 'task-set',
        slug: 'horse-image', op: 'generate', tool: 'bakin_exec_images_generate',
        description: 'first of a set', source: { kind: 'generated', path: null },
      })
      const outFile = join(testDir, 'companion.png')
      writeFileSync(outFile, 'companion')
      const generate = mock(async () => ({
        provider: 'openai', model: 'gpt-image-2',
        images: [{ filePath: outFile, mimeType: 'image/png', width: 1024, height: 1024 }],
        metadata: { servedBy: 'runtime' },
      }))
      const { ctx, created } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), generate } } } as never,
        { absPath: passFile, mimeType: 'image/png', version: 1 },
      )

      const result = await generateImage(ctx, {
        prompt: 'same style, different scene: grazing at dawn', taskId: 'task-set',
        provider: 'openai', model: 'gpt-image-2', surface: 'instagram-feed-portrait',
        referenceImages: [firstPass.assetId], allowNewAsset: true,
      }, 'pixel')

      expect(result.ok).toBe(true)
      expect(created).toHaveLength(1)
    })

    it('does NOT trip the iteration guard for an imported same-task reference', async () => {
      // main imported Mark's attachment against this task — referencing it is
      // the normal flow, not iteration.
      const refFile = join(testDir, 'attachment.png')
      writeFileSync(refFile, 'attachment')
      const { createAsset } = await import('../../../plugins/assets/lib/asset-service')
      const imported = await createAsset({
        sourceFilePath: refFile, type: 'images', agent: 'main', taskId: 'task-attach',
        slug: 'reference', op: 'import', tool: 'bakin_exec_images_import',
        description: 'attachment', source: { kind: 'import', path: refFile }, tags: ['reference'],
      })
      const outFile = join(testDir, 'from-attachment.png')
      writeFileSync(outFile, 'render')
      const generate = mock(async () => ({
        provider: 'openai', model: 'gpt-image-2',
        images: [{ filePath: outFile, mimeType: 'image/png', width: 1024, height: 1024 }],
        metadata: { servedBy: 'runtime' },
      }))
      const { ctx, created } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), generate } } } as never,
        { absPath: refFile, mimeType: 'image/png', version: 1 },
      )

      const result = await generateImage(ctx, {
        prompt: 'a horse like this', taskId: 'task-attach', provider: 'openai',
        model: 'gpt-image-2', surface: 'instagram-feed-portrait',
        referenceImages: [imported.assetId],
      }, 'pixel')

      expect(result.ok).toBe(true)
      expect(created).toHaveLength(1)
    })

    it('rejects an edit whose reference equals the asset being edited, before billing', async () => {
      const edit = mock(async () => { throw new Error('should not bill') })
      const { ctx } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), edit } } } as never,
        { absPath: join(testDir, 'base.png'), mimeType: 'image/png', version: 1 },
      )

      const result = await editImage(ctx, {
        assetId: '20260601-logo-aaaabbbb', prompt: 'tweak', taskId: 'task-self-ref',
        provider: 'openai', model: 'gpt-image-2', surface: 'instagram-feed-portrait',
        referenceImages: ['20260601-logo-aaaabbbb'],
      }, 'pixel')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/equals the asset being edited/i)
      expect(edit).not.toHaveBeenCalled()
    })

    it('rejects references on an unconfigured provider with a clear pre-flight error', async () => {
      // No runtime config and no Bakin key → servedBy 'unconfigured'. The gate
      // must give the pre-flight message, not a later opaque CLI failure.
      delete process.env.OPENAI_API_KEY
      delete process.env.GEMINI_API_KEY
      const generate = mock(async () => { throw new Error('should not bill') })
      const { ctx } = makeContext(
        { runtime: { images: { providers: mock(async () => []), generate } } } as never,
        { absPath: join(testDir, 'x.png'), mimeType: 'image/png', version: 1 },
      )

      const result = await generateImage(ctx, {
        prompt: 'x', taskId: 'task-unconf', provider: 'openai', model: 'gpt-image-2',
        surface: 'instagram-feed-portrait', referenceImages: ['20260601-horse-aaaabbbb'],
      }, 'pixel')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not configured/i)
      expect(generate).not.toHaveBeenCalled()
    })

    it('rejects an unresolvable assetId reference, before billing', async () => {
      const generate = mock(async () => { throw new Error('should not bill') })
      // sourceRef null → resolveVersionFile finds nothing for the reference id.
      const { ctx } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), generate } } } as never,
        null,
      )

      const result = await generateImage(ctx, {
        prompt: 'x', taskId: 'task-missing-ref', provider: 'openai', model: 'gpt-image-2',
        surface: 'instagram-feed-portrait', referenceImages: ['20260601-ghost-aaaabbbb'],
      }, 'pixel')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/reference asset not found/i)
      expect(generate).not.toHaveBeenCalled()
    })

    it('resolves a mixed assetId + raw-path reference list and records both in lineage', async () => {
      const outFile = join(testDir, 'mixed-gen.png')
      writeFileSync(outFile, 'img')
      const refAbs = join(testDir, 'managed-ref.png')
      writeFileSync(refAbs, 'managed')
      const loosePath = join(testDir, 'loose-ref.png')
      writeFileSync(loosePath, 'loose')
      const generate = mock(async () => ({
        provider: 'openai', model: 'gpt-image-2',
        images: [{ filePath: outFile, mimeType: 'image/png', width: 1024, height: 1024 }],
        metadata: { servedBy: 'runtime' },
      }))
      const { ctx, created } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), generate } } } as never,
        { absPath: refAbs, mimeType: 'image/png', version: 2 },
      )
      const refId = '20260601-swatch-ccccdddd'

      const result = await generateImage(ctx, {
        prompt: 'brand collage', taskId: 'task-mixed', provider: 'openai',
        model: 'gpt-image-2', surface: 'instagram-feed-portrait',
        referenceImages: [refId, loosePath],
      }, 'pixel')

      expect(result.ok).toBe(true)
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: [refAbs, loosePath] }))
      const refs = (created[0].generation as { references?: Array<{ assetId: string; version: number }> }).references
      expect(refs).toHaveLength(2)
      expect(refs).toContainEqual({ assetId: refId, version: 2 })
      expect(refs!.some(ref => ref.assetId !== refId && /^\d{8}-/.test(ref.assetId))).toBe(true)
    })

    it('a reference passed as a store-internal PATH maps to the existing asset — never a duplicate import', async () => {
      // Penguin-test incident: pixel passed .../store/<id>/v1.png instead of
      // the assetId and minted a clone of the already-imported reference.
      const srcFile = join(testDir, 'screenshot.png')
      writeFileSync(srcFile, 'screenshot-bytes')
      const { createAsset, listAssets: listReal } = await import('../../../plugins/assets/lib/asset-service')
      const { assetDirRelPath } = await import('../../../plugins/assets/lib/asset-id')
      const imported = await createAsset({
        sourceFilePath: srcFile, type: 'images', agent: 'pixel', taskId: 'task-storepath',
        slug: 'screenshot', op: 'import', tool: 'bakin_exec_images_import',
        description: 'screenshot', source: { kind: 'import', path: srcFile }, tags: ['reference'],
      })
      const storePath = join(testDir, assetDirRelPath(imported.assetId)!, 'v1.png')
      const outFile = join(testDir, 'penguinized.png')
      writeFileSync(outFile, 'render')
      const generate = mock(async () => ({
        provider: 'openai', model: 'gpt-image-2',
        images: [{ filePath: outFile, mimeType: 'image/png', width: 1024, height: 1024 }],
        metadata: { servedBy: 'runtime' },
      }))
      const { ctx, created } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), generate } } } as never,
        null,
      )
      const assetCountBefore = listReal().length

      const result = await generateImage(ctx, {
        prompt: 'replace thumbnails with penguins', taskId: 'task-storepath',
        provider: 'openai', model: 'gpt-image-2', surface: 'instagram-feed-portrait',
        referenceImages: [storePath],
      }, 'pixel')

      expect(result.ok).toBe(true)
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: [storePath] }))
      expect(created[0].generation).toMatchObject({ references: [{ assetId: imported.assetId, version: 1 }] })
      // No clone minted in the real store.
      expect(listReal().length).toBe(assetCountBefore)
    })

    it('resolves a media:// reference through the runtime and auto-imports it', async () => {
      const outFile = join(testDir, 'media-gen.png')
      writeFileSync(outFile, 'img')
      const mediaAbs = join(testDir, 'inbound-cat.png')
      writeFileSync(mediaAbs, 'cat-bytes')
      const generate = mock(async () => ({
        provider: 'openai', model: 'gpt-image-2',
        images: [{ filePath: outFile, mimeType: 'image/png', width: 1024, height: 1024 }],
        metadata: { servedBy: 'runtime' },
      }))
      const resolveUri = mock(async (uri: string) => uri === 'media://inbound/cat.png' ? mediaAbs : null)
      const { ctx, created } = makeContext(
        { runtime: { media: { resolveUri }, images: { providers: runtimeProvider(), generate } } } as never,
        null,
      )

      const result = await generateImage(ctx, {
        prompt: 'a cat like this', taskId: 'task-media', provider: 'openai',
        model: 'gpt-image-2', surface: 'instagram-feed-portrait',
        referenceImages: ['media://inbound/cat.png'],
      }, 'pixel')

      expect(result.ok).toBe(true)
      expect(resolveUri).toHaveBeenCalledWith('media://inbound/cat.png')
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: [mediaAbs] }))
      // The resolved file is auto-imported: lineage carries a minted assetId.
      const refs = (created[0].generation as { references?: Array<{ assetId: string }> }).references
      expect(refs).toHaveLength(1)
      expect(refs![0].assetId).toMatch(/^\d{8}-/)
    })

    it('rejects a media:// reference when the runtime cannot resolve media URIs, before billing', async () => {
      const generate = mock(async () => { throw new Error('should not bill') })
      const { ctx } = makeContext(
        { runtime: { images: { providers: runtimeProvider(), generate } } } as never,
        null,
      )

      const result = await generateImage(ctx, {
        prompt: 'x', taskId: 'task-media-unsupported', provider: 'openai', model: 'gpt-image-2',
        surface: 'instagram-feed-portrait', referenceImages: ['media://inbound/cat.png'],
      }, 'pixel')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/cannot resolve media:\/\/ URIs/i)
      expect(generate).not.toHaveBeenCalled()
    })

    it('rejects an unresolvable media:// reference, before billing', async () => {
      const generate = mock(async () => { throw new Error('should not bill') })
      const resolveUri = mock(async () => null)
      const { ctx } = makeContext(
        { runtime: { media: { resolveUri }, images: { providers: runtimeProvider(), generate } } } as never,
        null,
      )

      const result = await generateImage(ctx, {
        prompt: 'x', taskId: 'task-media-missing', provider: 'openai', model: 'gpt-image-2',
        surface: 'instagram-feed-portrait', referenceImages: ['media://inbound/gone.png'],
      }, 'pixel')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/reference media URI not found/i)
      expect(generate).not.toHaveBeenCalled()
    })
  })

  it('without taskId and no active chat turn, fails honestly before any billing', async () => {
    const generate = mock(async () => { throw new Error('must never be called') })
    const { ctx, created } = makeContext({ runtime: { images: { providers: mock(async () => []), generate } } as never })
    const result = await generateImage(ctx, { prompt: 'a pickle', surface: 'blog-hero' }, 'main')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no unambiguous active chat turn')
    expect(generate).not.toHaveBeenCalled()
    expect(created).toEqual([])
  })

  it('chat-bound generation: no taskId auto-binds to the active chat turn (asset taskId null)', async () => {
    const { getHookRegistry } = await import('../../../packages/core/src/hooks/hook-registry-singleton')
    const registry = getHookRegistry()
    registry.register(
      'chat.resolveActiveTurn',
      (data: Record<string, unknown>) => (data.agentId === 'main' ? { chatId: 'chat-42' } : null),
      { pluginId: 'test-chat-context' } as never,
    )
    try {
      const runtimeFile = join(testDir, 'chat-pickle.png')
      writeFileSync(runtimeFile, 'pickle-image')
      const generate = mock(async () => ({
        provider: 'google',
        model: 'gemini-3.1-flash-image-preview',
        images: [{ filePath: runtimeFile, mimeType: 'image/png', width: 1200, height: 630 }],
        metadata: {},
      }))
      const { ctx, created } = makeContext({ runtime: { images: { providers: mock(async () => []), generate } } as never })

      const result = await generateImage(
        ctx,
        { prompt: 'a very serious pickle', provider: 'google', model: 'gemini-3.1-flash-image-preview', surface: 'blog-hero' },
        'main',
      )
      expect(result.ok).toBe(true)
      expect(typeof result.assetId).toBe('string')
      expect(generate).toHaveBeenCalledTimes(1)
      // Asset carries NO task linkage — it belongs to the chat context.
      expect(created).toHaveLength(1)
      expect((created[0] as { taskId?: string | null }).taskId).toBeNull()
    } finally {
      registry.unregisterByPlugin('test-chat-context')
    }
  })

  it('refuses a billed generation when the budget cap is exhausted — no provider call, typed refusal (cost-control v2)', async () => {
    const { getHookRegistry } = await import('../../../packages/core/src/hooks/hook-registry-singleton')
    const { recordRunCost } = await import('../../../src/core/execution-ledger')
    const registry = getHookRegistry()
    // Register the models-plugin policy hooks under a throwaway plugin id so
    // unregisterByPlugin cleans the global registry after the test.
    registry.register('models.getBudgetPolicy', () => ({ rules: [{ scope: 'global', lane: 'metered', dailyCap: 1 }] }), { pluginId: 'test-budget' } as never)
    registry.register('models.resolveBilling', (d: Record<string, unknown>) => ({ provider: String(d.model ?? '').split('/')[0], lane: 'metered', model: d.model ?? null }), { pluginId: 'test-budget' } as never)
    try {
      // $2 attributed today against the $1 cap.
      recordRunCost({ runId: 'seed:media-gate', taskId: 't', agent: 'pixel', model: 'google/g', provider: 'google', lane: 'metered', totalTokens: 1, costUsdMicros: 2_000_000, occurredAt: Date.now() })

      const generate = mock(async () => { throw new Error('provider must not be called') })
      const { ctx } = makeContext({ runtime: { images: { providers: mock(async () => []), generate } } as never })
      const result = await generateImage(ctx, {
        prompt: 'over budget', taskId: 'task-budget-gate', provider: 'google', model: 'gemini-3.1-flash-image-preview', surface: 'blog-hero',
      }, 'pixel')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/budget exceeded/i)
      expect((result as { budget?: { code?: string } }).budget?.code).toBe('budget_exceeded')
      expect(generate).not.toHaveBeenCalled()
    } finally {
      registry.unregisterByPlugin('test-budget')
      // The ledger handle was opened against this test's temp home — close it
      // before afterEach rmSyncs the dir (stale-inode trap, CLAUDE.md).
      const { closeDb } = await import('../../../packages/core/src/storage/db')
      closeDb()
    }
  })
})
