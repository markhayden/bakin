import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
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
