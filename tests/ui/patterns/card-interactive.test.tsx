/**
 * Card parity contract (#966 D4.6): the Card shares the interactive-surface
 * overlay with ListRow (the one `cloneElement` kept under a reasoned
 * exception) — whole-surface activation with an accessible name, nested
 * controls independent, a `render` overlay merged and focusable.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import '../../rtl-settle'
import * as realRouter from '../../../packages/sdk/src/navigation/router'
const push = mock((_to: string) => {})
mock.module('../../../packages/sdk/src/navigation/router', () => ({
  ...realRouter,
  useRouter: () => ({ push, replace: mock(), back: mock() }),
}))
import { Card } from '@makinbakin/sdk/ui'
import { PluginLink } from '@makinbakin/sdk/navigation'

beforeEach(() => push.mockClear())

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

  it('forwards ref to the card element (ref is a plain prop)', () => {
    const ref = createRef<HTMLDivElement>()
    render(<Card ref={ref}><p>Asset</p></Card>)
    const card = document.querySelector('[data-slot="card"]')
    expect(card).not.toBeNull()
    expect(ref.current).toBe(card as HTMLDivElement)
  })

  it('a PluginLink overlay is client-routed: a plain click navigates, a modifier click falls through', () => {
    render(
      <Card interactive={{ label: 'Open the asset', render: <PluginLink to="/assets/1" /> }}>
        <p>Asset</p>
      </Card>,
    )
    const link = screen.getByRole('link', { name: 'Open the asset' })
    expect(link.tabIndex).toBe(0)
    expect(fireEvent.click(link, { button: 0 })).toBe(false)
    expect(push).toHaveBeenCalledWith('/assets/1')
    expect(fireEvent.click(link, { button: 0, ctrlKey: true })).toBe(true)
    expect(push).toHaveBeenCalledTimes(1)
  })
})
