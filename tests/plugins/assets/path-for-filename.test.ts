import { describe, it, expect, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'

// path-for-filename.ts is a pure module with no fs access, but the test-isolation
// enforcement hook requires this mock on every test that imports plugin code.
const testDir = join(tmpdir(), `bakin-test-path-for-filename-${Date.now()}`)
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import {
  pathForFilename,
  relPathForFilename,
  yearMonthFromFilename,
  isCanonicalFilename,
  isSafeCanonicalFilename,
} from '@bakin/assets/lib/path-for-filename'

describe('assets/path-for-filename', () => {
  describe('pathForFilename', () => {
    it('derives the full relative path for a canonical filename', () => {
      expect(pathForFilename('20260401-hero-a1b2c3d4.png'))
        .toBe('assets/store/2026-04/20260401-hero-a1b2c3d4.png')
    })

    it('handles multi-hyphen slugs', () => {
      expect(pathForFilename('20260415-q2-content-strategy-e5f6a7b8.md'))
        .toBe('assets/store/2026-04/20260415-q2-content-strategy-e5f6a7b8.md')
    })

    it('handles multi-dot extensions by preserving the trailing extension', () => {
      // The regex uses greedy `.+\..+` which anchors on the last dot.
      expect(pathForFilename('20260401-my-file-a1b2c3d4.tar.gz'))
        .toBe('assets/store/2026-04/20260401-my-file-a1b2c3d4.tar.gz')
    })

    it('returns null for names without a date prefix', () => {
      expect(pathForFilename('cool-picture.png')).toBeNull()
      expect(pathForFilename('hero-a1b2c3d4.png')).toBeNull()
    })

    it('returns null for names with too-few date digits', () => {
      expect(pathForFilename('2026040-hero-a1b2c3d4.png')).toBeNull()
      expect(pathForFilename('20264-hero-a1b2c3d4.png')).toBeNull()
    })

    it('returns null for names missing the slug separator', () => {
      expect(pathForFilename('20260401.png')).toBeNull()
    })

    it('returns null for names missing an extension', () => {
      expect(pathForFilename('20260401-hero-a1b2c3d4')).toBeNull()
    })

    it('returns null for invalid months', () => {
      expect(pathForFilename('20261301-hero-a1b2c3d4.png')).toBeNull()
      expect(pathForFilename('20260001-hero-a1b2c3d4.png')).toBeNull()
    })

    it('returns null for invalid days', () => {
      expect(pathForFilename('20260432-hero-a1b2c3d4.png')).toBeNull()
      expect(pathForFilename('20260400-hero-a1b2c3d4.png')).toBeNull()
    })

    it('returns null for implausible years', () => {
      expect(pathForFilename('19690401-hero-a1b2c3d4.png')).toBeNull()
    })

    it('accepts any valid year between 1970 and 9999', () => {
      expect(pathForFilename('19700101-x-a1b2c3d4.png'))
        .toBe('assets/store/1970-01/19700101-x-a1b2c3d4.png')
      expect(pathForFilename('99991231-x-a1b2c3d4.png'))
        .toBe('assets/store/9999-12/99991231-x-a1b2c3d4.png')
    })

    it('handles December correctly', () => {
      expect(pathForFilename('20261225-winter-a1b2c3d4.jpg'))
        .toBe('assets/store/2026-12/20261225-winter-a1b2c3d4.jpg')
    })

    it('handles January correctly (zero-padded month)', () => {
      expect(pathForFilename('20260103-new-year-a1b2c3d4.md'))
        .toBe('assets/store/2026-01/20260103-new-year-a1b2c3d4.md')
    })
  })

  describe('relPathForFilename', () => {
    it('strips the assets/ prefix', () => {
      expect(relPathForFilename('20260401-hero-a1b2c3d4.png'))
        .toBe('store/2026-04/20260401-hero-a1b2c3d4.png')
    })

    it('returns null for non-canonical names', () => {
      expect(relPathForFilename('badname.png')).toBeNull()
    })
  })

  describe('yearMonthFromFilename', () => {
    it('extracts YYYY-MM shard key', () => {
      expect(yearMonthFromFilename('20260401-hero-a1b2c3d4.png')).toBe('2026-04')
      expect(yearMonthFromFilename('20261225-winter-e5f6a7b8.jpg')).toBe('2026-12')
    })

    it('returns null for non-canonical names', () => {
      expect(yearMonthFromFilename('cool-picture.png')).toBeNull()
      expect(yearMonthFromFilename('20260401')).toBeNull()
    })
  })

  describe('isCanonicalFilename', () => {
    it('returns true for canonical names', () => {
      expect(isCanonicalFilename('20260401-hero-a1b2c3d4.png')).toBe(true)
      expect(isCanonicalFilename('20260415-q2-content-strategy-e5f6a7b8.md')).toBe(true)
    })

    it('returns false for non-canonical names', () => {
      expect(isCanonicalFilename('hero.png')).toBe(false)
      expect(isCanonicalFilename('20261301-x-a1b2c3d4.png')).toBe(false)
      expect(isCanonicalFilename('')).toBe(false)
    })
  })

  describe('isSafeCanonicalFilename', () => {
    it('accepts canonical filenames without path syntax', () => {
      expect(isSafeCanonicalFilename('20260401-hero-a1b2c3d4.png')).toBe(true)
      expect(isSafeCanonicalFilename('20260401-hero-a1b2c3d4.thumb.jpg')).toBe(true)
    })

    it('rejects path-shaped and traversal filenames', () => {
      expect(isSafeCanonicalFilename('assets/store/2026-04/20260401-hero-a1b2c3d4.png')).toBe(false)
      expect(isSafeCanonicalFilename('assets\\store\\2026-04\\20260401-hero-a1b2c3d4.png')).toBe(false)
      expect(isSafeCanonicalFilename('20260401-../hero-a1b2c3d4.png')).toBe(false)
    })

    it('rejects non-canonical names', () => {
      expect(isSafeCanonicalFilename('hero.png')).toBe(false)
      expect(isSafeCanonicalFilename('20261301-hero-a1b2c3d4.png')).toBe(false)
    })
  })
})
