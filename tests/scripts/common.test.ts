import { describe, it, expect, mock } from 'bun:test'
import {
  succeed,
  fail,
  slugify,
  datePrefixedFilename,
  getExtension,
  getBasename,
  resolveImageDimensions,
  withRetry,
  generateThumbnail,
  IMAGE_PRESETS,
  MAX_IMAGE_EDGE,
} from '../../scripts/lib/common'

describe('succeed / fail helpers', () => {
  it('succeed returns ok: true with data', () => {
    const result = succeed({ path: '/foo' })
    expect(result.ok).toBe(true)
    expect(result.path).toBe('/foo')
  })

  it('succeed with no data returns ok: true', () => {
    expect(succeed()).toEqual({ ok: true })
  })

  it('fail returns ok: false with error message', () => {
    const result = fail('something broke')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('something broke')
  })

  it('fail includes details when provided', () => {
    const result = fail('bad input', [{ field: 'name', message: 'required' }])
    expect(result.ok).toBe(false)
    expect(result.details).toEqual([{ field: 'name', message: 'required' }])
  })

  it('fail omits details key when not provided', () => {
    const result = fail('nope')
    expect(result).not.toHaveProperty('details')
  })
})

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Golden Hour Smoothie')).toBe('golden-hour-smoothie')
  })

  it('removes special characters', () => {
    expect(slugify('Hello World!!!')).toBe('hello-world')
  })

  it('collapses multiple hyphens', () => {
    expect(slugify('a---b')).toBe('a-b')
  })

  it('handles underscores', () => {
    expect(slugify('my_file_name')).toBe('my-file-name')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello')
  })

  it('truncates to maxLength', () => {
    const long = 'a'.repeat(100)
    expect(slugify(long, 10).length).toBeLessThanOrEqual(10)
  })

  it('handles empty string', () => {
    expect(slugify('')).toBe('')
  })
})

describe('datePrefixedFilename', () => {
  it('returns YYYYMMDD-slug.ext format', () => {
    const result = datePrefixedFilename('golden-hour', 'png')
    expect(result).toMatch(/^\d{8}-golden-hour\.png$/)
  })

  it('handles dot-prefixed extension', () => {
    const result = datePrefixedFilename('test', '.jpg')
    expect(result).toMatch(/^\d{8}-test\.jpg$/)
  })
})

describe('getExtension', () => {
  it('extracts extension', () => {
    expect(getExtension('photo.png')).toBe('png')
  })

  it('lowercases extension', () => {
    expect(getExtension('photo.PNG')).toBe('png')
  })

  it('returns empty for no extension', () => {
    expect(getExtension('Makefile')).toBe('')
  })

  it('handles paths with directories', () => {
    expect(getExtension('/foo/bar/baz.mp4')).toBe('mp4')
  })
})

describe('getBasename', () => {
  it('extracts basename without extension', () => {
    expect(getBasename('photo.png')).toBe('photo')
  })

  it('handles paths with directories', () => {
    expect(getBasename('/foo/bar/baz.mp4')).toBe('baz')
  })

  it('handles no extension', () => {
    expect(getBasename('Makefile')).toBe('Makefile')
  })
})

describe('resolveImageDimensions', () => {
  it('returns preset dimensions for social-portrait', () => {
    expect(resolveImageDimensions('social-portrait')).toEqual({ width: 1080, height: 1920 })
  })

  it('returns preset dimensions for social-square', () => {
    expect(resolveImageDimensions('social-square')).toEqual({ width: 1080, height: 1080 })
  })

  it('returns preset dimensions for social-landscape', () => {
    expect(resolveImageDimensions('social-landscape')).toEqual({ width: 1200, height: 675 })
  })

  it('defaults to social-portrait', () => {
    expect(resolveImageDimensions()).toEqual(IMAGE_PRESETS['social-portrait'])
  })

  it('caps custom dimensions at MAX_IMAGE_EDGE', () => {
    const result = resolveImageDimensions('custom', 5000, 3000)
    expect(result.width).toBe(MAX_IMAGE_EDGE)
    expect(result.height).toBe(MAX_IMAGE_EDGE)
  })

  it('uses custom dimensions when within limits', () => {
    expect(resolveImageDimensions('custom', 800, 600)).toEqual({ width: 800, height: 600 })
  })
})

describe('withRetry', () => {
  it('returns immediately on first success', async () => {
    const fn = mock().mockResolvedValue('ok')
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on failure and succeeds', async () => {
    const fn = mock()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockResolvedValue('ok')
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws after max attempts exhausted', async () => {
    const fn = mock().mockRejectedValue(new Error('always fails'))
    await expect(withRetry(fn, { maxAttempts: 2, baseDelayMs: 1 })).rejects.toThrow('always fails')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('uses default options when none provided', async () => {
    const fn = mock().mockResolvedValue(42)
    const result = await withRetry(fn)
    expect(result).toBe(42)
  })
})

describe('generateThumbnail', () => {
  it('returns null when ffmpeg fails', () => {
    // generateThumbnail uses execSync internally which will fail
    // since ffmpeg isn't available in test environment
    const result = generateThumbnail('/nonexistent/input.png', '/tmp/out.webp')
    expect(result).toBeNull()
  })
})
