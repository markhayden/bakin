import { describe, expect, it } from 'bun:test'
import {
  IMAGE_EXTENSION_TO_MIME,
  IMAGE_PROVIDER_ENV_VARS,
  extensionForImageMime,
} from '../../../packages/core/src/media/image-format'

describe('image-format (shared mime/ext + provider env-var source of truth)', () => {
  describe('extensionForImageMime', () => {
    it('maps canonical image mimes to extensions (gif is no longer mistyped as jpg)', () => {
      expect(extensionForImageMime('image/png')).toBe('png')
      expect(extensionForImageMime('image/jpeg')).toBe('jpg')
      expect(extensionForImageMime('image/webp')).toBe('webp')
      expect(extensionForImageMime('image/gif')).toBe('gif')
    })

    it('ignores mime parameters (charset, etc.) and casing', () => {
      expect(extensionForImageMime('image/PNG; charset=binary')).toBe('png')
      expect(extensionForImageMime('IMAGE/WEBP')).toBe('webp')
    })

    it('falls back to png for an unrecognized image mime', () => {
      expect(extensionForImageMime('image/unknown-xyz')).toBe('png')
    })
  })

  describe('IMAGE_EXTENSION_TO_MIME', () => {
    it('is the single source for image ext→mime', () => {
      expect(IMAGE_EXTENSION_TO_MIME['.png']).toBe('image/png')
      expect(IMAGE_EXTENSION_TO_MIME['.jpg']).toBe('image/jpeg')
      expect(IMAGE_EXTENSION_TO_MIME['.jpeg']).toBe('image/jpeg')
      expect(IMAGE_EXTENSION_TO_MIME['.webp']).toBe('image/webp')
      expect(IMAGE_EXTENSION_TO_MIME['.gif']).toBe('image/gif')
    })
  })

  describe('IMAGE_PROVIDER_ENV_VARS', () => {
    it('declares each provider’s credential env-var names exactly once', () => {
      expect(IMAGE_PROVIDER_ENV_VARS.openai).toEqual(['OPENAI_API_KEY'])
      expect(IMAGE_PROVIDER_ENV_VARS.google).toEqual(['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'])
    })
  })
})
