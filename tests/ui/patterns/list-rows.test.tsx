// @vitest-environment jsdom

import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { ListRow, ListRows } from '@makinbakin/sdk/patterns'
import { createRef } from 'react'
import '../../rtl-settle'

describe('ListRows', () => {
  it('uses individually bordered rows by default', () => {
    const rowRef = createRef<HTMLLIElement>()
    render(
      <ListRows aria-label="Lessons">
        <ListRow ref={rowRef}>First lesson</ListRow>
        <ListRow>Second lesson</ListRow>
      </ListRows>,
    )

    const list = screen.getByRole('list', { name: 'Lessons' })
    expect(list.tagName).toBe('UL')
    expect(list.getAttribute('data-list-rows')).toBe('')
    expect(list.getAttribute('data-variant')).toBe('bordered')
    expect(list.className).toContain('gap-bakin-2')
    expect(list.className).toContain('[&>[data-slot=list-row]]:rounded-bakin-surface')

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.tagName).toBe('LI')
    expect(rows[0]!.getAttribute('data-slot')).toBe('list-row')
    expect(rows[0]!.className).toContain('px-bakin-3')
    expect(rows[0]!.className).toContain('py-bakin-3')
    expect(rowRef.current).toBe(rows[0] as HTMLLIElement)
  })

  it('offers separated and plain relationships without changing list semantics', () => {
    const { rerender } = render(
      <ListRows aria-label="Activity" variant="separated">
        <ListRow>First event</ListRow>
        <ListRow>Second event</ListRow>
      </ListRows>,
    )

    let list = screen.getByRole('list', { name: 'Activity' })
    expect(list.getAttribute('data-variant')).toBe('separated')
    expect(list.className).toContain('border-y')
    expect(list.className).toContain('[&>[data-slot=list-row]:not(:last-child)]:border-b')

    rerender(
      <ListRows aria-label="Timeline" variant="plain" className="custom-list">
        <ListRow className="custom-row">Event</ListRow>
      </ListRows>,
    )

    list = screen.getByRole('list', { name: 'Timeline' })
    expect(list.getAttribute('data-variant')).toBe('plain')
    expect(list.className).toContain('custom-list')
    expect(list.className).not.toContain('border-y')
    expect(screen.getByRole('listitem').className).toContain('custom-row')
  })
})
