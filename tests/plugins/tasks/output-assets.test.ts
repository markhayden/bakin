import { describe, expect, it } from 'bun:test'
import { isRenderableAssetRef } from '../../../plugins/tasks/lib/output-assets'

describe('task output asset rendering', () => {
  it('accepts canonical image filenames (legacy)', () => {
    expect(isRenderableAssetRef('20260420-hero-a1b2c3d4.png')).toBe(true)
    expect(isRenderableAssetRef('20260420-hero-a1b2c3d4.JPG')).toBe(true)
  })

  it('accepts versioned assetIds (no extension)', () => {
    expect(isRenderableAssetRef('20260420-hero-a1b2c3d4')).toBe(true)
    expect(isRenderableAssetRef('20260531-screenshot-2026-05-30-at-50539-pmpng-ef02456f')).toBe(true)
  })

  it('rejects path-shaped values', () => {
    expect(isRenderableAssetRef('assets/store/2026-04/20260420-hero-a1b2c3d4.png')).toBe(false)
    expect(isRenderableAssetRef('assets\\store\\2026-04\\20260420-hero-a1b2c3d4.png')).toBe(false)
  })

  it('rejects non-canonical or unsafe values', () => {
    expect(isRenderableAssetRef('hero.png')).toBe(false)
    expect(isRenderableAssetRef('20261320-hero-a1b2c3d4.png')).toBe(false)
    expect(isRenderableAssetRef('20260420-../hero-a1b2c3d4.png')).toBe(false)
    // A non-image, non-assetId filename (txt without the -<8hex> tail) is not rendered.
    expect(isRenderableAssetRef('20260420-hero-nothex.txt')).toBe(false)
    // Plain prose / arbitrary strings.
    expect(isRenderableAssetRef('TASK COMPLETE')).toBe(false)
  })
})
