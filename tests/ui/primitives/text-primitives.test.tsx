/**
 * Text + Overline public contract.
 *
 * The load-bearing test here is the merge one. Both the size and the tone are
 * `text-*` utilities, so tailwind-merge treats them as a single group and keeps
 * only the last — writing the size as `text-bakin-typography-size-meta` means it
 * disappears the moment a colour is applied, and nothing in the rendered DOM
 * looks wrong until you measure the font. That defect shipped once already
 * (see the `cn purges bakin size tokens` note), so it is pinned here.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import { Overline, Text } from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('Text public contract', () => {
  it('keeps the size utility when a tone colour is applied', () => {
    render(<Text size="meta" tone="muted">Last indexed 4 minutes ago</Text>)
    const el = screen.getByText('Last indexed 4 minutes ago')
    // Both must survive: the shorthand form would leave only the colour.
    expect(el.className).toContain('text-[length:var(--bakin-typography-size-meta)]')
    expect(el.className).toContain('text-bakin-text-muted')
  })

  it('keeps the size utility when the caller also passes a colour', () => {
    render(<Text size="meta" className="text-bakin-signal-danger">Over budget</Text>)
    const el = screen.getByText('Over budget')
    expect(el.className).toContain('text-[length:var(--bakin-typography-size-meta)]')
    expect(el.className).toContain('text-bakin-signal-danger')
  })

  it('lets a caller override the size without stacking two font sizes', () => {
    render(<Text size="meta" className="text-[length:var(--bakin-typography-size-body)]">Grown</Text>)
    const className = screen.getByText('Grown').className
    expect(className).toContain('--bakin-typography-size-body')
    expect(className).not.toContain('--bakin-typography-size-meta')
  })

  it('de-emphasises with a colour token and never an opacity fade', () => {
    render(<Text tone="muted">Quiet</Text>)
    const el = screen.getByText('Quiet')
    expect(el.getAttribute('data-tone')).toBe('muted')
    // Contrast-safe de-emphasis is the doctrine: opacity fades are banned.
    expect(el.className).not.toMatch(/\bopacity-/)
  })

  it('defaults to a body-size span with primary tone', () => {
    render(<Text>Plain</Text>)
    const el = screen.getByText('Plain')
    expect(el.tagName).toBe('SPAN')
    expect(el.className).toContain('text-[length:var(--bakin-typography-size-body)]')
    expect(el.className).toContain('text-bakin-text-primary')
  })

  it('drops the browser margin when rendered as a paragraph', () => {
    render(<Text as="p">Paragraph</Text>)
    // Layout owns spacing; callers should not need to pair every <p> with m-0.
    expect(screen.getByText('Paragraph').className).toContain('m-0')
  })

  it('applies the mono family only when asked', () => {
    render(<><Text mono>9f2c1ab4</Text><Text>plain</Text></>)
    expect(screen.getByText('9f2c1ab4').className).toContain('font-bakin-typography-family-mono')
    expect(screen.getByText('plain').className).not.toContain('font-bakin-typography-family-mono')
  })
})

describe('Overline public contract', () => {
  it('renders one canonical treatment, size included', () => {
    render(<Overline>Capabilities</Overline>)
    const className = screen.getByText('Capabilities').className
    expect(className).toContain('text-[length:var(--bakin-typography-size-meta)]')
    expect(className).toContain('uppercase')
    expect(className).toContain('tracking-wider')
    expect(className).toContain('font-bakin-typography-weight-semibold')
    expect(className).toContain('text-bakin-text-muted')
  })

  it('is a label, not a heading', () => {
    render(<Overline>Capabilities</Overline>)
    // An overline must not enter the document outline — a real heading is the
    // supported way to do that.
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByText('Capabilities').getAttribute('data-slot')).toBe('overline')
  })
})
