/**
 * Card parity contract (#966 D4.6): the Card shares the interactive-surface
 * overlay with ListRow (the one `cloneElement` kept under a reasoned
 * exception) — whole-surface activation with an accessible name, nested
 * controls independent, a `render` overlay merged and focusable.
 */
import { describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { Card } from '@makinbakin/sdk/ui'
import '../../rtl-settle'

describe('Card — interactive surface', () => {
  it('routes whole-card activation through the overlay button and leaves nested controls independent', () => {
    const onActivate = mock(() => {})
    const onNested = mock(() => {})
    render(
      <Card interactive={{ label: 'Open the asset', onActivate }}>
        <p>Asset</p>
        <button type="button" onClick={onNested}>Download</button>
      </Card>,
    )
    const overlay = screen.getByRole('button', { name: 'Open the asset' })
    expect(overlay.getAttribute('data-slot')).toBe('surface-overlay')
    fireEvent.click(overlay)
    expect(onActivate).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(onNested).toHaveBeenCalledTimes(1)
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('a render overlay keeps its own element, gains the overlay name and classes, and takes focus', () => {
    render(
      <Card interactive={{ label: 'Open the asset', render: <a href="/assets/1" className="custom-link" /> }}>
        <p>Asset</p>
      </Card>,
    )
    const link = screen.getByRole('link', { name: 'Open the asset' })
    expect(link.getAttribute('href')).toBe('/assets/1')
    expect(link.getAttribute('data-slot')).toBe('surface-overlay')
    expect(link.className).toContain('custom-link')
    link.focus()
    expect(document.activeElement).toBe(link)
  })
})
