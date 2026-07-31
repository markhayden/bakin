// @vitest-environment jsdom

import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { CalendarGrid } from '@makinbakin/sdk/patterns'
import '../../rtl-settle'

// Fixed instants — July 2026; July 15 is a Wednesday.
const JULY = new Date(2026, 6, 1)
const NOW = new Date(2026, 6, 15, 10, 30)

interface Item {
  key: string
  date?: Date
  allDay?: boolean
  title: string
}

const renderItem = (item: Item) => <button type="button">{item.title}</button>

describe('CalendarGrid month view', () => {
  it('renders a labeled 7-column grid with headers, today marking, and placed items', () => {
    render(
      <CalendarGrid
        view="month"
        date={JULY}
        now={NOW}
        label="July 2026"
        items={[
          { key: 'a', date: new Date(2026, 6, 15, 9, 0), title: 'Standup' },
          { key: 'b', date: new Date(2026, 6, 3, 9, 0), title: 'Old brief' },
        ]}
        renderItem={renderItem}
      />,
    )

    const grid = screen.getByRole('grid', { name: 'July 2026' })
    expect(grid.getAttribute('data-view')).toBe('month')
    expect(screen.getAllByRole('columnheader')).toHaveLength(7)
    expect(screen.getAllByRole('columnheader')[0]!.textContent).toBe('Sun')

    const today = screen.getByRole('gridcell', { name: 'Wednesday, July 15, 1 item' })
    expect(today.getAttribute('data-today')).toBe('')
    expect(today.textContent).toContain('Standup')

    // A day before `now` is dimmed as past.
    const past = screen.getByRole('gridcell', { name: 'Friday, July 3, 1 item' })
    expect(past.getAttribute('data-past')).toBe('')
    expect(screen.getByRole('gridcell', { name: 'Thursday, July 16, no items' })).toBeDefined()
  })

  it('collapses beyond maxVisibleItems behind an accessible overflow disclosure', () => {
    const items: Item[] = ['One', 'Two', 'Three', 'Four', 'Five'].map((title, index) => ({
      key: title,
      date: new Date(2026, 6, 15, 8 + index, 0),
      title,
    }))
    render(
      <CalendarGrid view="month" date={JULY} now={NOW} label="July 2026" items={items} renderItem={renderItem} />,
    )

    expect(screen.getByText('Three')).toBeDefined()
    expect(screen.queryByText('Four')).toBeNull()

    const disclosure = screen.getByRole('button', { name: '+2 more' })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(disclosure)

    expect(screen.getByText('Five')).toBeDefined()
    const collapse = screen.getByRole('button', { name: 'Show less' })
    expect(collapse.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(collapse)
    expect(screen.queryByText('Four')).toBeNull()
  })

  it('supports roving arrow navigation, Home/End, and Enter into cell content', () => {
    render(
      <CalendarGrid
        view="month"
        date={JULY}
        now={NOW}
        label="July 2026"
        items={[{ key: 'a', date: new Date(2026, 6, 15, 9, 0), title: 'Standup' }]}
        renderItem={renderItem}
      />,
    )

    // Today's cell is the single tab stop.
    const today = screen.getByRole('gridcell', { name: 'Wednesday, July 15, 1 item' })
    expect(today.tabIndex).toBe(0)
    today.focus()

    fireEvent.keyDown(today, { key: 'ArrowRight' })
    const thursday = screen.getByRole('gridcell', { name: 'Thursday, July 16, no items' })
    expect(document.activeElement).toBe(thursday)
    expect(thursday.tabIndex).toBe(0)
    expect(today.tabIndex).toBe(-1)

    fireEvent.keyDown(thursday, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: 'Thursday, July 9, no items' }))

    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: 'Sunday, July 5, no items' }))
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: 'Saturday, July 11, no items' }))

    // Enter hands focus to the first interactive item in the cell.
    today.focus()
    fireEvent.keyDown(today, { key: 'Enter' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Standup' }))
  })

  it('does not navigate onto leading blank cells', () => {
    render(
      <CalendarGrid view="month" date={JULY} now={NOW} label="July 2026" items={[]} renderItem={renderItem} />,
    )

    // July 1, 2026 is a Wednesday — Sunday–Tuesday of the first row are blanks.
    const first = screen.getByRole('gridcell', { name: 'Wednesday, July 1, no items' })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(first)
  })
})

describe('CalendarGrid week view', () => {
  it('renders hour rowheaders, day columnheaders, and hour-cell placement', () => {
    render(
      <CalendarGrid
        view="week"
        date={new Date(2026, 6, 15)}
        now={NOW}
        label="Week of July 12"
        items={[
          { key: 'a', date: new Date(2026, 6, 15, 23, 5), title: 'Late release' },
          { key: 'b', date: new Date(2026, 6, 15, 23, 30), title: 'Second late item' },
        ]}
        renderItem={renderItem}
      />,
    )

    const grid = screen.getByRole('grid', { name: 'Week of July 12' })
    expect(grid.getAttribute('data-view')).toBe('week')
    expect(screen.getByRole('rowheader', { name: '12 AM' })).toBeDefined()
    expect(screen.getByRole('rowheader', { name: '11 PM' })).toBeDefined()
    // 8 columnheaders: sr-only time gutter + 7 days.
    expect(screen.getAllByRole('columnheader')).toHaveLength(8)

    const cell = screen.getByRole('gridcell', { name: 'Wednesday, July 15, 11 PM, 2 items' })
    expect(cell.textContent).toContain('Late release')
    expect(cell.textContent).toContain('Second late item')
    // No all-day lane without all-day items.
    expect(screen.queryByRole('rowheader', { name: 'All day' })).toBeNull()
  })

  it('renders the all-day lane and consumer day-header content', () => {
    render(
      <CalendarGrid
        view="week"
        date={new Date(2026, 6, 15)}
        now={NOW}
        label="Week of July 12"
        items={[{ key: 'launch', date: new Date(2026, 6, 17, 0, 0), allDay: true, title: 'Launch day' }]}
        renderItem={renderItem}
        renderDayHeader={(day) => (day.getDate() === 15 ? <span>2 recurring</span> : null)}
      />,
    )

    expect(screen.getByRole('rowheader', { name: 'All day' })).toBeDefined()
    const lane = screen.getByRole('gridcell', { name: 'Friday, July 17, all day, 1 item' })
    expect(lane.textContent).toContain('Launch day')

    const headers = screen.getAllByRole('columnheader')
    const wednesday = headers.find((header) => header.textContent?.includes('Wed'))
    expect(wednesday?.textContent).toContain('2 recurring')
    expect(wednesday?.getAttribute('data-today')).toBe('')
  })

  it('drops items outside the visible Sunday-start week', () => {
    render(
      <CalendarGrid
        view="week"
        date={new Date(2026, 6, 15)}
        now={NOW}
        label="Week of July 12"
        items={[
          { key: 'inside', date: new Date(2026, 6, 12, 1, 0), title: 'Inside' },
          { key: 'next-week', date: new Date(2026, 6, 19, 0, 0), title: 'Next week' },
        ]}
        renderItem={renderItem}
      />,
    )

    expect(screen.getByText('Inside')).toBeDefined()
    expect(screen.queryByText('Next week')).toBeNull()
  })
})

describe('CalendarGrid day view', () => {
  it('renders hour rows, marks the current hour, and places items', () => {
    render(
      <CalendarGrid
        view="day"
        date={new Date(2026, 6, 15)}
        now={NOW}
        label="Today"
        items={[
          { key: 'a', date: new Date(2026, 6, 15, 23, 5), title: 'Late release' },
          { key: 'offsite', date: new Date(2026, 6, 15, 0, 0), allDay: true, title: 'Offsite' },
        ]}
        renderItem={renderItem}
      />,
    )

    const region = screen.getByRole('region', { name: 'Today' })
    expect(region.getAttribute('data-view')).toBe('day')
    expect(screen.getByText('11 PM')).toBeDefined()
    expect(screen.getByText('Late release')).toBeDefined()
    expect(screen.getByText('Offsite')).toBeDefined()

    const current = region.querySelector('[data-current-hour]')
    expect(current?.textContent).toContain('10 AM')
  })

  it('marks no current hour when the anchor date is not today', () => {
    render(
      <CalendarGrid
        view="day"
        date={new Date(2026, 6, 14)}
        now={NOW}
        label="Yesterday"
        items={[]}
        renderItem={renderItem}
      />,
    )

    expect(screen.getByRole('region', { name: 'Yesterday' }).querySelector('[data-current-hour]')).toBeNull()
  })
})
