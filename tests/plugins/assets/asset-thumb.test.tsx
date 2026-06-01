// @vitest-environment jsdom
import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { AssetThumb } from '../../../plugins/assets/components/versioned/atoms'

describe('AssetThumb', () => {
  it('uses the version thumbnail when an image thumbnail exists', () => {
    render(<AssetThumb assetId="20260601-space-pig-a1b2c3d4" type="images" version={1} hasThumb={true} />)

    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('/api/assets/20260601-space-pig-a1b2c3d4/v/1/thumb')
  })

  it('falls back to the image version when no thumbnail exists', () => {
    render(<AssetThumb assetId="20260601-space-pig-a1b2c3d4" type="images" version={1} hasThumb={false} />)

    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('/api/assets/20260601-space-pig-a1b2c3d4/v/1')
  })
})
