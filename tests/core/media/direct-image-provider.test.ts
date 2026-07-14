import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The module under test never touches the content dir (it writes to OS tmpdir),
// but mock the resolvers anyway so a future import can't leak into ~/.bakin/.
const testDir = join(tmpdir(), `bakin-test-direct-image-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import {
  generateDirectImage,
  isDirectImageProvider,
  resolveDirectImageKey,
} from '../../../packages/core/src/media/direct-image-provider'

describe('direct-image-provider', () => {
  afterEach(() => mock.restore())

  describe('isDirectImageProvider', () => {
    it('recognizes only the native providers', () => {
      expect(isDirectImageProvider('openai')).toBe(true)
      expect(isDirectImageProvider('google')).toBe(true)
      expect(isDirectImageProvider('openrouter')).toBe(false)
    })
  })

  describe('resolveDirectImageKey', () => {
    it('reads provider keys from env only', () => {
      expect(resolveDirectImageKey('openai', { OPENAI_API_KEY: 'oa' })).toBe('oa')
      expect(resolveDirectImageKey('google', { GEMINI_API_KEY: 'g1' })).toBe('g1')
      expect(resolveDirectImageKey('google', { GOOGLE_AI_API_KEY: 'g2' })).toBe('g2')
      expect(resolveDirectImageKey('openai', {})).toBeNull()
    })
  })

  describe('generateDirectImage', () => {
    it('snaps non-square surfaces onto a supported OpenAI size', async () => {
      const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }),
      } as unknown as Response)

      const result = await generateDirectImage({
        provider: 'openai',
        model: 'gpt-image-2',
        prompt: 'portrait',
        width: 1080,
        height: 1350,
        quality: 'standard',
        apiKey: 'key',
      })

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
      expect(body.size).toBe('1024x1536')
      expect(result.filePath).toMatch(/\.png$/)
    })

    it('extracts inline image data from Gemini', async () => {
      spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('g').toString('base64') } }] } }],
        }),
      } as unknown as Response)

      const result = await generateDirectImage({
        provider: 'google',
        model: 'gemini-3.1-flash-image-preview',
        prompt: 'brand shot',
        width: 1024,
        height: 1024,
        quality: 'standard',
        apiKey: 'key',
      })
      expect(result.mimeType).toBe('image/png')
    })

    describe('rejects options it cannot honor, before billing (#379)', () => {
      const base = {
        provider: 'openai' as const,
        model: 'gpt-image-2',
        prompt: 'x',
        width: 1024,
        height: 1024,
        quality: 'standard' as const,
        apiKey: 'key',
      }

      it.each([
        ['count > 1', { count: 2 }],
        ['aspectRatio', { aspectRatio: '16:9' }],
        ['resolution', { resolution: '4K' }],
        ['background', { background: 'transparent' as const }],
        ['outputFormat webp', { outputFormat: 'webp' as const }],
        ['size', { size: '1024x1536' }],
      ])('throws on %s without making a provider call', async (_label, extra) => {
        const fetchSpy = spyOn(globalThis, 'fetch')
        await expect(generateDirectImage({ ...base, ...extra })).rejects.toThrow()
        expect(fetchSpy).not.toHaveBeenCalled()
      })

      it('allows the honored single-png path (count 1, outputFormat png)', async () => {
        const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }),
        } as unknown as Response)
        await expect(
          generateDirectImage({ ...base, count: 1, outputFormat: 'png' }),
        ).resolves.toBeDefined()
        expect(fetchSpy).toHaveBeenCalledTimes(1)
      })
    })

    it('never retries a failed generation (no double-bill), even on a 5xx', async () => {
      // Generation is non-idempotent and billed — a transient-looking failure
      // must NOT trigger a second paid call. fetch is invoked exactly once.
      const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'service unavailable',
      } as unknown as Response)

      await expect(generateDirectImage({
        provider: 'openai',
        model: 'gpt-image-2',
        prompt: 'x',
        width: 1024,
        height: 1024,
        quality: 'standard',
        apiKey: 'key',
      })).rejects.toThrow(/503/)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })
})

describe('generateDirectImage — input images (edit / multi-reference)', () => {
  const { mkdirSync, writeFileSync, rmSync } = require('node:fs') as typeof import('node:fs')
  const imgDir = join(testDir, 'inputs')
  const png = (name: string) => {
    mkdirSync(imgDir, { recursive: true })
    const p = join(imgDir, name)
    writeFileSync(p, Buffer.from('fake-png-bytes'))
    return p
  }
  afterEach(() => {
    rmSync(imgDir, { recursive: true, force: true })
    mock.restore() // this describe sits outside the main one's restore scope
  })

  const base = {
    model: 'gpt-image-1',
    prompt: 'the bear, but doing the polka',
    width: 1024,
    height: 1024,
    quality: 'standard' as const,
    apiKey: 'key',
  }

  it('routes OpenAI input images to /v1/images/edits as multipart with image[] parts', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('edited').toString('base64') }] }),
    } as unknown as Response)

    const result = await generateDirectImage({
      ...base,
      provider: 'openai',
      inputImages: [png('bear.png'), png('polka-ref.jpg')],
    })

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/v1/images/edits')
    const form = init.body as FormData
    expect(form).toBeInstanceOf(FormData)
    const images = form.getAll('image[]') as Blob[]
    expect(images).toHaveLength(2)
    expect(images[0]!.type).toBe('image/png')
    expect(images[1]!.type).toBe('image/jpeg')
    expect(form.get('prompt')).toBe(base.prompt)
    // Multipart boundary is fetch's job — no manual Content-Type.
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    expect(result.filePath).toMatch(/\.png$/)
  })

  it('adds Gemini input images as inline_data parts before the prompt text', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('out').toString('base64') } }] } }] }),
    } as unknown as Response)

    await generateDirectImage({
      ...base,
      provider: 'google',
      model: 'gemini-image',
      inputImages: [png('bear.png')],
    })

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    const parts = body.contents[0].parts
    expect(parts).toHaveLength(2)
    expect(parts[0].inline_data.mime_type).toBe('image/png')
    expect(parts[1].text).toContain('polka')
  })

  it('rejects missing input files and >16 inputs BEFORE any billed call', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    await expect(generateDirectImage({
      ...base, provider: 'openai', inputImages: [join(imgDir, 'nope.png')],
    })).rejects.toThrow(/input image not found/)
    const seventeen = Array.from({ length: 17 }, (_, i) => png(`r${i}.png`))
    await expect(generateDirectImage({
      ...base, provider: 'openai', inputImages: seventeen,
    })).rejects.toThrow(/max 16/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
