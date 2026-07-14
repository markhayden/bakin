/**
 * adapter-pi images — codex-native PRIMARY (existing openai-codex OAuth,
 * zero API keys; generation AND edits with input images), direct-provider
 * shim FALLBACK for explicit openai/google routes with a Bakin key.
 * Wire shape probed live 2026-07-07 (chatgpt.com/backend-api/codex/responses,
 * image_generation tool, SSE image_generation_call result).
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-pi-images-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = join(testDir, 'pi')
process.env.BAKIN_HOME = join(testDir, 'bakin')

const contentDirMock = () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ home: join(testDir, 'bakin'), db: join(testDir, 'bakin', 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

// Shim fallback is core-shared and separately tested — mock the billed call.
const shimCalls: Array<Record<string, unknown>> = []
mock.module('../../../packages/core/src/media/direct-image-provider', () => ({
  isDirectImageProvider: (id: string) => id === 'openai' || id === 'google',
  generateDirectImage: async (request: Record<string, unknown>) => {
    shimCalls.push(request)
    return { filePath: join(testDir, 'shim-out.png'), mimeType: 'image/png', width: 1024, height: 1024 }
  },
}))

import type { RuntimeError } from '../../../packages/core/src/adapters/runtime'
import type { PluginContext } from '@bakin/core/plugin-types'
import { createPiRuntimeAdapter } from '../../../packages/adapter-pi/src/index'
import { resetPiHome } from '../../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../../packages/adapter-pi/src/models'
import { createImagesSurface } from '../../../packages/adapter-pi/src/images'
import type { FetchLike } from '../../../packages/adapter-pi/src/codex-images'
import { providerReadiness } from '../../../plugins/images/lib/providers'

const NativeResponse = (await (Bun as unknown as { fetch: typeof fetch }).fetch('data:text/plain,x')).constructor as typeof Response

// A fake codex OAuth JWT whose payload carries the account-id claim.
const FAKE_JWT = ['h', Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-123' } })).toString('base64url'), 's'].join('.')
const TINY_PNG_B64 = Buffer.from('fake-png-bytes').toString('base64')

function sseImageResponse(): Response {
  const body = [
    `data: {"type":"response.output_item.done","item":{"type":"image_generation_call","id":"ig_1","result":"${TINY_PNG_B64}"}}`,
    '',
    'data: [DONE]',
    '', '',
  ].join('\n')
  return new NativeResponse(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const codexCalls: Array<{ url: string; init: Record<string, unknown> }> = []
const fakeFetch: FetchLike = async (url, init) => {
  codexCalls.push({ url, init })
  return sseImageResponse()
}

const adapter = createPiRuntimeAdapter()

beforeAll(async () => {
  resetPiHome()
  resetModelRegistry()
  const agentDir = join(testDir, 'pi', 'agent')
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({
    'openai-codex': { type: 'oauth', access: FAKE_JWT, refresh: 'r', expires: Date.now() + 86_400_000 },
  }))
  writeFileSync(join(testDir, 'base-asset.png'), 'base-asset-bytes')
  writeFileSync(join(testDir, 'shim-out.png'), 'shim-bytes')
  await adapter.initialize({ contentDir: join(testDir, 'bakin') })
})

afterAll(() => {
  delete process.env.OPENAI_API_KEY
  rmSync(testDir, { recursive: true, force: true })
})

describe('codex-native images (primary route)', () => {
  test('generate: OAuth headers + image_generation tool + temp file result with runtime provenance', async () => {
    codexCalls.length = 0
    const surface = createImagesSurface({ fetchImpl: fakeFetch })
    const result = await surface.generate({ prompt: 'a red circle', outputFormat: 'png' })

    const call = codexCalls[0]
    expect(call.url).toBe('https://chatgpt.com/backend-api/codex/responses')
    const headers = call.init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${FAKE_JWT}`)
    expect(headers['chatgpt-account-id']).toBe('acct-123')
    const body = JSON.parse(call.init.body as string)
    expect(body.model).toBe('gpt-5.4-mini') // cheapest working carrier — burn control
    expect(body.tools).toEqual([{ type: 'image_generation', output_format: 'png' }])

    expect(existsSync(result.images[0].filePath)).toBe(true)
    expect(readFileSync(result.images[0].filePath, 'utf-8')).toBe('fake-png-bytes')
    expect(result.model).toBe('gpt-image-2')
    expect(result.metadata).toMatchObject({ servedBy: 'runtime', credentialSource: 'runtime', sizingHonored: false })
  })

  test('edit: input files become input_image data URLs on the same wire', async () => {
    codexCalls.length = 0
    const surface = createImagesSurface({ fetchImpl: fakeFetch })
    const result = await surface.edit({ prompt: 'make it blue', files: [join(testDir, 'base-asset.png')] })
    const body = JSON.parse(codexCalls[0].init.body as string)
    const content = body.input[0].content as Array<{ type: string; image_url?: string }>
    expect(content[0].type).toBe('input_text')
    expect(content[1].type).toBe('input_image')
    expect(content[1].image_url).toContain(Buffer.from('base-asset-bytes').toString('base64'))
    expect(existsSync(result.images[0].filePath)).toBe(true)
  })

  test('backend 429 classifies as provider_cooldown; missing image is runtime_failed', async () => {
    const surface429 = createImagesSurface({
      fetchImpl: async () => new NativeResponse('{"error":"rate limited"}', { status: 429 }),
    })
    try {
      await surface429.generate({ prompt: 'x' })
      throw new Error('expected reject')
    } catch (err) {
      expect((err as RuntimeError).kind).toBe('provider_cooldown')
    }

    const surfaceEmpty = createImagesSurface({
      fetchImpl: async () => new NativeResponse('data: [DONE]\n\n', { status: 200 }),
    })
    try {
      await surfaceEmpty.generate({ prompt: 'x' })
      throw new Error('expected reject')
    } catch (err) {
      expect((err as RuntimeError).kind).toBe('runtime_failed')
      expect((err as Error).message).toContain('without returning an image')
    }
  })

  test('carrier model is overridable via settings (burn control)', async () => {
    codexCalls.length = 0
    const surface = createImagesSurface({ fetchImpl: fakeFetch, carrierModel: 'gpt-5.4' })
    await surface.generate({ prompt: 'x' })
    expect(JSON.parse(codexCalls[0].init.body as string).model).toBe('gpt-5.4')
  })

  test('providers() reports codex configured; plugin readiness routes servedBy runtime', async () => {
    const providers = await adapter.images!.providers()
    expect(providers[0]).toMatchObject({ id: 'openai-codex', configured: true, defaultModel: 'gpt-image-2' })
    expect(providers[0].capabilities?.edit?.enabled).toBe(true)

    const ctx = { runtime: adapter } as unknown as PluginContext
    const readiness = await providerReadiness(ctx)
    const codex = readiness.find((p) => p.id === 'openai-codex')
    expect(codex?.servedBy).toBe('runtime')
  })
})

describe('shim fallback (explicit direct-provider routes)', () => {
  test('provider openai + Bakin key rides the shared shim', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    const surface = createImagesSurface({ fetchImpl: fakeFetch })
    const result = await surface.generate({ prompt: 'x', provider: 'openai', model: 'gpt-image-1' })
    expect(result.metadata).toMatchObject({ servedBy: 'shim', credentialSource: 'bakin-env' })
  })

  test('provider openai without a key points at the keyless codex route', async () => {
    delete process.env.OPENAI_API_KEY
    const surface = createImagesSurface({ fetchImpl: fakeFetch })
    try {
      await surface.generate({ prompt: 'x', provider: 'openai' })
      throw new Error('expected reject')
    } catch (err) {
      expect((err as Error).message).toContain('codex route needs no key')
    }
  })
})

describe('shim edit + references (WS3: input images off the codex path)', () => {
  test('edit() on a direct provider routes through the shim with files as inputImages', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    try {
      shimCalls.length = 0
      const surface = createImagesSurface()
      const base = join(testDir, 'edit-base.png')
      const ref = join(testDir, 'edit-ref.png')
      writeFileSync(base, 'png'); writeFileSync(ref, 'png')
      const result = await surface.edit({ prompt: 'polka', provider: 'openai', model: 'gpt-image-1', files: [base, ref] })
      expect(result.metadata?.servedBy).toBe('shim')
      expect(shimCalls[0]!.inputImages).toEqual([base, ref])
    } finally {
      delete process.env.OPENAI_API_KEY
    }
  })

  test('generate() with referenceImages on a direct provider threads them as inputImages', async () => {
    process.env.GEMINI_API_KEY = 'g-test'
    try {
      shimCalls.length = 0
      const surface = createImagesSurface()
      const ref = join(testDir, 'gen-ref.png')
      writeFileSync(ref, 'png')
      await surface.generate({ prompt: 'bear', provider: 'google', model: 'gemini-3.1-flash-image-preview', referenceImages: [ref] })
      expect(shimCalls[0]!.inputImages).toEqual([ref])
      expect(shimCalls[0]!.provider).toBe('google')
    } finally {
      delete process.env.GEMINI_API_KEY
    }
  })

  test('providers() advertises keyed direct providers with edit capability; unkeyed stay unconfigured', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_AI_API_KEY
    try {
      const surface = createImagesSurface()
      const rows = await surface.providers()
      const openai = rows.find((r) => r.id === 'openai')!
      const google = rows.find((r) => r.id === 'google')!
      expect(openai.configured).toBe(true)
      expect(openai.capabilities?.edit?.enabled).toBe(true)
      expect(google.configured).toBe(false)
      // The routing engine marks keyed direct providers routable.
      const readiness = await providerReadiness({ runtime: { images: { providers: async () => rows } } } as never)
      const ready = readiness.find((r) => r.id === 'openai')!
      expect(ready.routable).toBe(true)
    } finally {
      delete process.env.OPENAI_API_KEY
    }
  })
})
