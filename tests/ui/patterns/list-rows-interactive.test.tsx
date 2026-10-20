/**
 * ListRow parity contract (#966 D4.6): with `ref` now a plain prop, the
 * interactive row must keep its public behaviour — the ref reaches the
 * <li>, the whole-surface overlay carries the action with an accessible
 * name, nested controls stay independent, and a `render` overlay is a real
 * client-routed element with the row's classes merged in.
 * Contract: storybook/public/lists/list-rows.stories.tsx — InteractiveRows.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import '../../rtl-settle'
import * as realRouter from '../../../packages/sdk/src/navigation/router'
// The client router is the one thing the test environment shims (tests/shims/
// tanstack-router.ts); PluginLink navigates through this wrapper, so it is
// the seam where routed activation is observable.
const push = mock((_to: string) => {})
mock.module('../../../packages/sdk/src/navigation/router', () => ({
  ...realRouter,
  useRouter: () => ({ push, replace: mock(), back: mock() }),
}))
import { ListRow, ListRows } from '@makinbakin/sdk/patterns'
import { PluginLink } from '@makinbakin/sdk/navigation'

beforeEach(() => push.mockClear())

describe('ListRow — interactive surface', () => {
  it('forwards ref to the <li> and routes whole-surface activation through the overlay button', () => {
    const rowRef = createRef<HTMLLIElement>()
    const onActivate = mock(() => {})
    render(
      <ListRows aria-label="Items">
        <ListRow ref={rowRef} interactive={{ label: 'Open first item', onActivate }}>
          First item
        </ListRow>
      </ListRows>,
    )
    const row = screen.getByRole('listitem')
    expect(rowRef.current).toBe(row as HTMLLIElement)
    expect(row.getAttribute('data-interactive')).toBe('')
    const overlay = within(row).getByRole('button', { name: 'Open first item' })
    expect(overlay.getAttribute('data-slot')).toBe('surface-overlay')
    fireEvent.click(overlay)
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('keeps nested controls independent of the surface action', () => {
    const onActivate = mock(() => {})
    const onNested = mock(() => {})
    render(
      <ListRows aria-label="Items">
        <ListRow interactive={{ label: 'Open item', onActivate }}>
          Item <button type="button" onClick={onNested}>Pin</button>
        </ListRow>
      </ListRows>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    expect(onNested).toHaveBeenCalledTimes(1)
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('a render overlay is the supplied element with the overlay role, name and merged classes; it takes focus', () => {
    render(
      <ListRows aria-label="Items">
        <ListRow interactive={{ label: 'Open item', render: <a href="/items/1" className="custom-link" /> }}>
          Item
        </ListRow>
      </ListRows>,
    )
    const link = screen.getByRole('link', { name: 'Open item' })
    expect(link.getAttribute('href')).toBe('/items/1')
    expect(link.getAttribute('data-slot')).toBe('surface-overlay')
    expect(link.className).toContain('custom-link')
    expect(link.className).toContain('absolute')
    link.focus()
    expect(document.activeElement).toBe(link)
  })

  it('a PluginLink overlay is client-routed: a plain click navigates without a full load, modifier clicks fall through to the browser', () => {
    render(
      <ListRows aria-label="Items">
        <ListRow interactive={{ label: 'Open item', render: <PluginLink to="/items/1" /> }}>
          Item
        </ListRow>
      </ListRows>,
    )
    const link = screen.getByRole('link', { name: 'Open item' })
    expect(link.getAttribute('href')).toBe('/items/1')
    expect(link.getAttribute('data-slot')).toBe('surface-overlay')
    // Keyboard reach: a native anchor with an href — focusable and Enter-activatable by the platform.
    expect(link.tabIndex).toBe(0)
    link.focus()
    expect(document.activeElement).toBe(link)
    const plain = fireEvent.click(link, { button: 0 })
    expect(plain).toBe(false) // default prevented: the router took it
    expect(push).toHaveBeenCalledWith('/items/1')
    const modified = fireEvent.click(link, { button: 0, metaKey: true })
    expect(modified).toBe(true) // left to the browser (new tab)
    expect(push).toHaveBeenCalledTimes(1)
  })
})
