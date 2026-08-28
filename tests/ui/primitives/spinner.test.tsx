/**
 * Spinner public contract.
 *
 * The primitive exists because 21 hand-rolled `<Loader2 className="animate-spin" />`
 * copies were wrong in two consistent ways: 20 of them were silent to assistive
 * tech, and 18 spun regardless of `prefers-reduced-motion`. Both are pinned here
 * so the primitive cannot regress into the thing it replaced.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import { Spinner } from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('Spinner accessibility contract', () => {
  it('announces itself as a live status when labelled', () => {
    render(<Spinner label="Loading agents" />)
    const spinner = screen.getByRole('status', { name: 'Loading agents' })
    expect(spinner.getAttribute('aria-hidden')).toBeNull()
  })

  it('hides completely when unlabelled, rather than being visible but nameless', () => {
    const { container } = render(<Spinner />)
    // The banned third state: assistive tech can see it but cannot describe it.
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.querySelector('[data-slot=spinner]')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Spinner motion contract', () => {
  it('always stops animating under reduced motion', () => {
    const { container } = render(<Spinner label="Loading" />)
    const cls = container.querySelector('[data-slot=spinner]')!.className
    expect(cls).toContain('animate-spin')
    expect(cls).toContain('motion-reduce:animate-none')
  })

  it('keeps the reduced-motion guard even when a caller passes its own classes', () => {
    const { container } = render(<Spinner label="Loading" className="ml-bakin-1 inline" />)
    const cls = container.querySelector('[data-slot=spinner]')!.className
    expect(cls).toContain('motion-reduce:animate-none')
    expect(cls).toContain('ml-bakin-1')
  })
})

describe('Spinner sizing', () => {
  it('defaults to medium and accepts small', () => {
    const { container, rerender } = render(<Spinner label="a" />)
    expect(container.querySelector('[data-slot=spinner]')!.className).toContain('size-bakin-4')
    rerender(<Spinner label="a" size="sm" />)
    expect(container.querySelector('[data-slot=spinner]')!.className).toContain('size-bakin-3')
  })
})
