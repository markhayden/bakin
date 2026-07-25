import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import '../../rtl-settle'
import { VersionRow } from '../../../plugins/assets/components/versioned/VersionRow'

afterEach(cleanup)

const version = {
  version: 2,
  file: 'popcorn-v2.jpg',
  thumb: 'popcorn-v2-thumb.jpg',
  mimeType: 'image/jpeg',
  size: 2048,
  width: 1200,
  height: 1600,
  created: '2026-07-04T16:00:00.000Z',
  description: 'Final crop',
  tags: ['food'],
  op: 'edit' as const,
  parentVersion: 1,
  tool: null,
  prompt: null,
  promptHash: null,
  generation: null,
}

describe('VersionRow', () => {
  it('exposes version selection as a real pressed button without nesting row actions', () => {
    const onSelect = mock()
    const onPromote = mock()
    const onDelete = mock()

    render(
      <VersionRow
        assetId="asset-popcorn"
        assetType="images"
        version={version}
        isCurrent={false}
        isSelected
        canDelete
        onSelect={onSelect}
        onPromote={onPromote}
        onDelete={onDelete}
      />,
    )

    const preview = screen.getByRole('button', { name: 'Preview version 2' })
    expect(preview.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(preview)
    expect(onSelect).toHaveBeenCalledWith(2)

    fireEvent.click(screen.getByRole('button', { name: 'Delete version 2' }))
    expect(onDelete).toHaveBeenCalledWith(2)
    expect(onSelect).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Make version 2 current' }))
    expect(onPromote).toHaveBeenCalledWith(2)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
