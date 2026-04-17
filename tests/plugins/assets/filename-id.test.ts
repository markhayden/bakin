import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

// Test isolation: even though filename-id.ts is pure/in-memory, the hook
// requires this mock to keep the enforcement blanket.
const testDir = join(tmpdir(), `bakin-test-filename-id-${Date.now()}`)
vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import {
  generateId8,
  generateConventionalFilename,
  isConventional,
  extractId8,
  primaryStem,
  slugify,
} from '@bakin/assets/lib/filename-id'

describe('assets/filename-id', () => {
  describe('generateId8', () => {
    it('returns 8 hex chars', () => {
      const id = generateId8()
      expect(id).toMatch(/^[0-9a-f]{8}$/)
    })

    it('is effectively unique across many calls', () => {
      const set = new Set<string>()
      for (let i = 0; i < 10_000; i++) set.add(generateId8())
      expect(set.size).toBe(10_000)
    })
  })

  describe('generateConventionalFilename', () => {
    it('produces YYYYMMDD-slug-id8.ext', () => {
      const name = generateConventionalFilename('hero', 'png', 'a1b2c3d4')
      expect(name).toMatch(/^\d{8}-hero-a1b2c3d4\.png$/)
    })

    it('slugifies the slug argument', () => {
      const name = generateConventionalFilename('My Big Image!', 'jpg', 'deadbeef')
      expect(name).toMatch(/^\d{8}-my-big-image-deadbeef\.jpg$/)
    })

    it('normalizes leading dot in extension', () => {
      const name = generateConventionalFilename('x', '.PNG', 'deadbeef')
      expect(name.endsWith('.png')).toBe(true)
    })

    it('generates id8 when not provided', () => {
      const name = generateConventionalFilename('hero', 'png')
      expect(name).toMatch(/^\d{8}-hero-[0-9a-f]{8}\.png$/)
    })

    it('falls back to "asset" slug if empty after slugify', () => {
      const name = generateConventionalFilename('!!!', 'png', 'deadbeef')
      expect(name).toMatch(/^\d{8}-asset-deadbeef\.png$/)
    })
  })

  describe('isConventional', () => {
    it('matches YYYYMMDD-slug-id8.ext', () => {
      expect(isConventional('20260416-hero-a1b2c3d4.png')).toBe(true)
    })

    it('matches any-slug-id8.ext (no date prefix required)', () => {
      expect(isConventional('hero-a1b2c3d4.png')).toBe(true)
    })

    it('rejects filenames without the hex suffix', () => {
      expect(isConventional('20260416-hero.png')).toBe(false)
      expect(isConventional('plain.png')).toBe(false)
    })

    it('rejects non-hex suffixes', () => {
      expect(isConventional('20260416-hero-zzzzzzzz.png')).toBe(false)
    })

    it('rejects wrong-length suffixes', () => {
      expect(isConventional('20260416-hero-abcd.png')).toBe(false)
      expect(isConventional('20260416-hero-abcdef0123.png')).toBe(false)
    })
  })

  describe('extractId8', () => {
    it('extracts the id8 suffix from a conformant filename', () => {
      expect(extractId8('20260416-hero-a1b2c3d4.png')).toBe('a1b2c3d4')
    })

    it('returns null for non-conformant filenames', () => {
      expect(extractId8('plain.png')).toBeNull()
    })
  })

  describe('primaryStem', () => {
    it('returns the filename without extension', () => {
      expect(primaryStem('20260416-hero-a1b2c3d4.png')).toBe('20260416-hero-a1b2c3d4')
    })

    it('returns the whole name if no extension', () => {
      expect(primaryStem('README')).toBe('README')
    })
  })

  describe('slugify', () => {
    it('lowercases and hyphenates', () => {
      expect(slugify('My Big Image')).toBe('my-big-image')
    })

    it('strips punctuation', () => {
      expect(slugify('Hello, World!')).toBe('hello-world')
    })

    it('truncates to maxLength', () => {
      expect(slugify('a'.repeat(100), 10)).toBe('aaaaaaaaaa')
    })
  })
})
