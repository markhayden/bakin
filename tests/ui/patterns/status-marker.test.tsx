// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatusMarker } from '@makinbakin/sdk/patterns'

describe('StatusMarker', () => {
  it('exposes a visible semantic label when used without nearby status copy', () => {
    render(<StatusMarker tone="danger" label="Failed" />)

    expect(screen.getByRole('img', { name: 'Failed' }).getAttribute('data-tone')).toBe('danger')
  })

  it('stays decorative when adjacent copy already names the status', () => {
    const { container } = render(<StatusMarker tone="success" />)

    expect(container.querySelector('[data-status-marker]')?.getAttribute('aria-hidden')).toBe('true')
  })
})
