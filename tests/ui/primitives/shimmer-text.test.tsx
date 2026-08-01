// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import { ShimmerText } from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('ShimmerText public contract', () => {
  it('sweeps by default with the ink highlight and reduced-motion discipline', () => {
    render(<ShimmerText>Generating summary…</ShimmerText>)
    const label = screen.getByText('Generating summary…')

    expect(label.tagName).toBe('SPAN')
    expect(label.getAttribute('data-slot')).toBe('shimmer-text')
    expect(label.getAttribute('data-active')).toBe('true')
    expect(label.getAttribute('data-highlight')).toBe('ink')
    expect(label.className).toContain('animate-shimmer-sweep')
    expect(label.className).toContain('motion-reduce:animate-none')
    expect(label.className).toContain('bg-clip-text')
    expect(label.className).toContain('text-transparent')
    // Static mid-sweep pin: the value reduced motion falls back to.
    expect(label.className).toContain('[background-position:50%_50%]')
    expect(label.className).toContain('[background-size:300%_100%]')
  })

  it('renders a plain span with stable data attributes when inactive', () => {
    render(
      <ShimmerText active={false} className="text-bakin-text-muted">
        Idle
      </ShimmerText>,
    )
    const label = screen.getByText('Idle')

    expect(label.tagName).toBe('SPAN')
    expect(label.getAttribute('data-slot')).toBe('shimmer-text')
    expect(label.getAttribute('data-active')).toBe('false')
    expect(label.getAttribute('data-highlight')).toBe('ink')
    expect(label.className).toBe('text-bakin-text-muted')
    expect(label.className).not.toContain('animate-shimmer-sweep')
  })

  it('switches the bright band through the closed highlight vocabulary', () => {
    render(
      <>
        <ShimmerText>Ink band</ShimmerText>
        <ShimmerText highlight="accent">Accent band</ShimmerText>
      </>,
    )

    const ink = screen.getByText('Ink band')
    const accent = screen.getByText('Accent band')
    expect(ink.getAttribute('data-highlight')).toBe('ink')
    expect(accent.getAttribute('data-highlight')).toBe('accent')
    // Both variant declarations ship on every active span; data-highlight selects.
    for (const label of [ink, accent]) {
      expect(label.className).toContain(
        'data-[highlight=ink]:[--shimmer-text-band:var(--bakin-color-text-primary)]',
      )
      expect(label.className).toContain(
        'data-[highlight=accent]:[--shimmer-text-band:var(--bakin-color-signal-accent)]',
      )
    }
  })

  it('adds no semantics of its own', () => {
    render(<ShimmerText>Working</ShimmerText>)
    const label = screen.getByText('Working')

    expect(label.getAttribute('role')).toBeNull()
    expect(label.getAttribute('aria-hidden')).toBeNull()
  })
})

it('base vocabulary selects the resting token and defaults to muted', () => {
  const { container, rerender } = render(<ShimmerText>Working</ShimmerText>)
  let el = container.querySelector('[data-slot="shimmer-text"]')
  expect(el?.getAttribute('data-base')).toBe('muted')
  rerender(<ShimmerText base="primary">Working</ShimmerText>)
  el = container.querySelector('[data-slot="shimmer-text"]')
  expect(el?.getAttribute('data-base')).toBe('primary')
  expect(el?.className).toContain('data-[base=primary]')
})
