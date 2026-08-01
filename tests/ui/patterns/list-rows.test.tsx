// @vitest-environment jsdom

import { describe, expect, it } from 'bun:test'
import { render, screen, within } from '@testing-library/react'
import { ListRow, ListRowGroup, ListRowLabels, ListRows } from '@makinbakin/sdk/patterns'
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

  it('names each grouped list from its ListRowGroup heading', () => {
    render(
      <div>
        <ListRowGroup label="Pinned" data-testid="pinned-group">
          <ListRows variant="plain">
            <ListRow>Release checklist</ListRow>
          </ListRows>
        </ListRowGroup>
        <ListRowGroup label="Today">
          <ListRows variant="plain">
            <ListRow>Brand kit review</ListRow>
            <ListRow>Search outage triage</ListRow>
          </ListRows>
        </ListRowGroup>
      </div>,
    )

    const pinned = screen.getByRole('list', { name: 'Pinned' })
    const today = screen.getByRole('list', { name: 'Today' })
    expect(within(pinned).getAllByRole('listitem')).toHaveLength(1)
    expect(within(today).getAllByRole('listitem')).toHaveLength(2)

    const group = screen.getByTestId('pinned-group')
    expect(group.getAttribute('data-slot')).toBe('list-row-group')
    const label = group.querySelector('[data-slot=list-row-group-label]')!
    expect(label.textContent).toBe('Pinned')
    expect(label.id).not.toBe('')
    expect(pinned.getAttribute('aria-labelledby')).toBe(label.id)
    // The heading is outside the list: it never counts as a list item.
    expect(within(group).getAllByRole('listitem')).toHaveLength(1)
  })

  it('lets an explicit list label win over the group heading', () => {
    render(
      <ListRowGroup label="Today">
        <ListRows variant="plain" aria-label="Today's chats">
          <ListRow>Brand kit review</ListRow>
        </ListRows>
      </ListRowGroup>,
    )

    const list = screen.getByRole('list', { name: "Today's chats" })
    expect(list.getAttribute('aria-labelledby')).toBeNull()
  })

  it('shares one grid template across rows via the columns capability', () => {
    render(
      <ListRows
        aria-label="Dispatch routes"
        variant="separated"
        columns="minmax(9rem,.7fr) minmax(0,1fr) auto"
      >
        <ListRow>First route</ListRow>
        <ListRow>Second route</ListRow>
      </ListRows>,
    )

    const list = screen.getByRole('list', { name: 'Dispatch routes' })
    expect(list.getAttribute('data-columns')).toBe('')
    expect(list.className).toContain('@container/list-rows')
    expect(list.style.getPropertyValue('--bakin-list-row-columns')).toBe(
      'minmax(9rem,.7fr) minmax(0,1fr) auto',
    )

    for (const row of screen.getAllByRole('listitem')) {
      expect(row.className).toContain('grid')
      expect(row.className).toContain('gap-bakin-3')
      // Default breakpoint 3xl, default alignment center.
      expect(row.className).toContain(
        '@3xl/list-rows:[grid-template-columns:var(--bakin-list-row-columns)]',
      )
      expect(row.className).toContain('@3xl/list-rows:items-center')
    }
  })

  it('parameterizes the columns breakpoint and alignment', () => {
    render(
      <ListRows aria-label="Budget rules" columns="auto 1fr" columnsAt="5xl" columnsAlign="end">
        <ListRow>Rule</ListRow>
      </ListRows>,
    )

    const row = screen.getByRole('listitem')
    expect(row.className).toContain(
      '@5xl/list-rows:[grid-template-columns:var(--bakin-list-row-columns)]',
    )
    expect(row.className).toContain('@5xl/list-rows:items-end')
    expect(row.className).not.toContain('@3xl/list-rows:items-center')
  })

  it('keeps rows unchanged when columns is not set', () => {
    render(
      <ListRows aria-label="Plain rows">
        <ListRow>Row</ListRow>
      </ListRows>,
    )

    const list = screen.getByRole('list', { name: 'Plain rows' })
    expect(list.className).not.toContain('@container/list-rows')
    expect(list.getAttribute('data-columns')).toBeNull()
    const row = screen.getByRole('listitem')
    expect(row.className).not.toContain('grid-template-columns')
  })

  it('renders an aria-hidden labels row bound to the active breakpoint', () => {
    const { container } = render(
      <ListRows aria-label="Dispatch routes" columns="1fr auto" columnsAt="2xl">
        <ListRowLabels>
          <span>Work class</span>
          <span>Status</span>
        </ListRowLabels>
        <ListRow>Subagent work</ListRow>
      </ListRows>,
    )

    const labels = container.querySelector('[data-slot=list-row-labels]')!
    expect(labels.getAttribute('aria-hidden')).toBe('true')
    expect(labels.className).toContain('hidden')
    expect(labels.className).toContain('@2xl/list-rows:grid')
    expect(labels.className).toContain(
      '@2xl/list-rows:[grid-template-columns:var(--bakin-list-row-columns)]',
    )
    // The labels row is decorative: it never joins the list item count.
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('keeps the labels row hidden when the list declares no columns', () => {
    const { container } = render(
      <ListRows aria-label="No columns">
        <ListRowLabels>
          <span>Name</span>
        </ListRowLabels>
        <ListRow>Row</ListRow>
      </ListRows>,
    )

    const labels = container.querySelector('[data-slot=list-row-labels]')!
    expect(labels.className).toContain('hidden')
    expect(labels.className).not.toContain('grid-template-columns')
  })
})
