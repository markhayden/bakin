import { describe, expect, it } from 'bun:test'
import { isRenderableAssetImageFilename } from '../../../plugins/tasks/lib/output-assets'

describe('task output asset rendering', () => {
  it('accepts canonical image filenames', () => {
    expect(isRenderableAssetImageFilename('20260420-hero-a1b2c3d4.png')).toBe(true)
    expect(isRenderableAssetImageFilename('20260420-hero-a1b2c3d4.JPG')).toBe(true)
  })

  it('rejects path-shaped image values', () => {
    expect(isRenderableAssetImageFilename('assets/store/2026-04/20260420-hero-a1b2c3d4.png')).toBe(false)
    expect(isRenderableAssetImageFilename('assets\\store\\2026-04\\20260420-hero-a1b2c3d4.png')).toBe(false)
  })

  it('rejects non-canonical or unsafe filenames', () => {
    expect(isRenderableAssetImageFilename('hero.png')).toBe(false)
    expect(isRenderableAssetImageFilename('20261320-hero-a1b2c3d4.png')).toBe(false)
    expect(isRenderableAssetImageFilename('20260420-../hero-a1b2c3d4.png')).toBe(false)
    expect(isRenderableAssetImageFilename('20260420-hero-a1b2c3d4.txt')).toBe(false)
  })
})
