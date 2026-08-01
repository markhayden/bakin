// @vitest-environment jsdom

import { describe, expect, it } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { CalendarGrid } from '@makinbakin/sdk/patterns'
import '../../rtl-settle'

// Pin a NEGATIVE-offset timezone so the UTC date-string footgun would bite:
// `new Date('2026-07-15')` parses as UTC midnight = July 14 18:00 in Denver.
// All other fixtures use local Date constructors, which are TZ-neutral here.
process.env.TZ = 'America/Denver'

// Fixed instants — July 2026; July 15 is a Wednesday.
const JULY = new Date(2026, 6, 1)
const NOW = new Date(2026, 6, 15, 10, 30)

interface Item {
  key: string
  date?: Date | string
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

    // A day before `now` is marked as past (visual dimming is opt-in).
    const past = screen.getByRole('gridcell', { name: 'Friday, July 3, 1 item' })
    expect(past.getAttribute('data-past')).toBe('')
    expect(screen.getByRole('gridcell', { name: 'Thursday, July 16, no items' })).toBeDefined()
  })

  it('dims past-day item stacks only when dimPastDays is set', () => {
    const items: Item[] = [{ key: 'old', date: new Date(2026, 6, 3, 9, 0), title: 'Old brief' }]
    const { unmount } = render(
      <CalendarGrid view="month" date={JULY} now={NOW} label="July 2026" items={items} renderItem={renderItem} />,
    )
    const cell = screen.getByRole('gridcell', { name: 'Friday, July 3, 1 item' })
    expect(cell.getAttribute('data-past')).toBe('')
    expect(cell.querySelector('.opacity-50')).toBeNull()
    unmount()

    render(
      <CalendarGrid
        view="month"
        date={JULY}
        now={NOW}
        label="July 2026"
        items={items}
        renderItem={renderItem}
        dimPastDays
      />,
    )
    const dimmed = screen.getByRole('gridcell', { name: 'Friday, July 3, 1 item' })
    expect(dimmed.querySelector('.opacity-50')).not.toBeNull()
  })

  it('renders muted, navigable adjacent-month days with items when outsideDays="muted"', async () => {
    render(
      <CalendarGrid
        view="month"
        date={JULY}
        now={NOW}
        label="July 2026"
        items={[{ key: 'retro', date: new Date(2026, 5, 30, 9, 0), title: 'June retro' }]}
        renderItem={renderItem}
        outsideDays="muted"
      />,
    )

    // July 2026 starts on a Wednesday: June 28–30 lead, August 1 trails.
    const outside = screen.getByRole('gridcell', { name: 'Tuesday, June 30, 1 item' })
    expect(outside.getAttribute('data-outside')).toBe('')
    expect(outside.textContent).toContain('June retro')
    expect(screen.getByRole('gridcell', { name: 'Saturday, August 1, no items' })).toBeDefined()

    // Outside days are real cells — arrow navigation reaches them.
    const first = screen.getByRole('gridcell', { name: 'Wednesday, July 1, no items' })
    await act(async () => { first.focus() })
    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(outside)
  })

  it('renders the renderDayHeader slot beside the month day number', () => {
    render(
      <CalendarGrid
        view="month"
        date={JULY}
        now={NOW}
        label="July 2026"
        items={[
          { key: 'a', date: new Date(2026, 6, 15, 9, 0), title: 'Launch post' },
          { key: 'b', date: new Date(2026, 6, 15, 10, 0), title: 'Thread' },
          { key: 'c', date: new Date(2026, 6, 15, 11, 0), title: 'Newsletter' },
        ]}
        renderItem={renderItem}
        renderDayHeader={(day) => (day.getDate() === 15 && day.getMonth() === 6 ? <span>3 posts</span> : null)}
      />,
    )

    const cell = screen.getByRole('gridcell', { name: 'Wednesday, July 15, 3 items' })
    expect(cell.querySelector('[data-slot="calendar-day-header"]')?.textContent).toContain('3 posts')
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

  it('supports roving arrow navigation, Home/End, and Enter into cell content', async () => {
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
    await act(async () => { today.focus() })

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
    await act(async () => { today.focus() })
    fireEvent.keyDown(today, { key: 'Enter' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Standup' }))
  })

  it('does not navigate onto leading blank cells', async () => {
    render(
      <CalendarGrid view="month" date={JULY} now={NOW} label="July 2026" items={[]} renderItem={renderItem} />,
    )

    // July 1, 2026 is a Wednesday — Sunday–Tuesday of the first row are blanks.
    const first = screen.getByRole('gridcell', { name: 'Wednesday, July 1, no items' })
    await act(async () => { first.focus() })
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

describe('CalendarGrid date-string parsing', () => {
  it('places plain YYYY-MM-DD strings on the LOCAL day, not the UTC day', () => {
    // Under naive `new Date('2026-07-15')` parsing this is July 14 18:00 in
    // America/Denver — the item would render one day early and this fails.
    render(
      <CalendarGrid
        view="month"
        date={JULY}
        now={NOW}
        label="July 2026"
        items={[{ key: 'post', date: '2026-07-15', title: 'Launch post' }]}
        renderItem={renderItem}
      />,
    )

    const cell = screen.getByRole('gridcell', { name: 'Wednesday, July 15, 1 item' })
    expect(cell.textContent).toContain('Launch post')
    expect(screen.getByRole('gridcell', { name: 'Tuesday, July 14, no items' })).toBeDefined()
  })

  it('keeps timestamped strings on instant semantics', () => {
    render(
      <CalendarGrid
        view="week"
        date={new Date(2026, 6, 15)}
        now={NOW}
        label="Week of July 12"
        items={[{ key: 'sync', date: '2026-07-15T09:00:00', title: 'Sync' }]}
        renderItem={renderItem}
      />,
    )

    const cell = screen.getByRole('gridcell', { name: 'Wednesday, July 15, 9 AM, 1 item' })
    expect(cell.textContent).toContain('Sync')
  })
})

describe('CalendarGrid granularity="day"', () => {
  it('collapses the week into one lane per day with no hour grid', () => {
    render(
      <CalendarGrid
        view="week"
        date={new Date(2026, 6, 15)}
        now={NOW}
        label="Week of July 12"
        items={[
          { key: 'post', date: '2026-07-15', title: 'Launch post' },
          { key: 'offsite', date: '2026-07-15', allDay: true, title: 'Offsite' },
          { key: 'thread', date: '2026-07-15', title: 'Thread' },
          { key: 'recap', date: '2026-07-17', title: 'Recap' },
        ]}
        renderItem={renderItem}
        granularity="day"
      />,
    )

    const grid = screen.getByRole('grid', { name: 'Week of July 12' })
    expect(grid.getAttribute('data-granularity')).toBe('day')
    // No hour rows, no separate all-day lane, no time gutter.
    expect(screen.queryByRole('rowheader')).toBeNull()
    expect(screen.queryByText('12 AM')).toBeNull()
    expect(screen.getAllByRole('columnheader')).toHaveLength(7)

    // All-day and timed items share the day lane in input order.
    const lane = screen.getByRole('gridcell', { name: 'Wednesday, July 15, 3 items' })
    const titles = Array.from(lane.querySelectorAll('button')).map((node) => node.textContent)
    expect(titles).toEqual(['Launch post', 'Offsite', 'Thread'])
    expect(screen.getByRole('gridcell', { name: 'Friday, July 17, 1 item' }).textContent).toContain('Recap')
  })

  it('renders the day view as a flat agenda list of the day in input order', () => {
    render(
      <CalendarGrid
        view="day"
        date={new Date(2026, 6, 15)}
        now={NOW}
        label="Today"
        items={[
          { key: 'offsite', date: '2026-07-15', allDay: true, title: 'Offsite' },
          { key: 'post', date: '2026-07-15', title: 'Launch post' },
          { key: 'tomorrow', date: '2026-07-16', title: 'Not today' },
        ]}
        renderItem={renderItem}
        granularity="day"
      />,
    )

    const region = screen.getByRole('region', { name: 'Today' })
    expect(region.getAttribute('data-granularity')).toBe('day')
    expect(screen.queryByText('12 AM')).toBeNull()
    expect(screen.queryByText('All day')).toBeNull()
    expect(screen.queryByText('Not today')).toBeNull()

    const titles = Array.from(region.querySelectorAll('button')).map((node) => node.textContent)
    expect(titles).toEqual(['Offsite', 'Launch post'])
  })
})
