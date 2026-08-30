import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { CalendarGrid } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Lists/CalendarGrid',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'CalendarGrid is the shared calendar structure behind month (7-column day grid), week (hour-by-day grid with an all-day lane), and day (hour-row agenda) views. The kit owns grid geometry, day and hour headers, today and current-hour marking, opt-in past-day dimming (`dimPastDays`), roving keyboard cell navigation (arrows move, Home/End jump within the row, Enter enters the cell\'s first item), and the month overflow disclosure. Consumers own every item — chips, cards, popovers, drag — via `renderItem`, plus range navigation controls (previous/next/today) and item ordering, which is preserved per cell. Items are placed by their local `date`/`start` instant; plain `YYYY-MM-DD` strings parse as LOCAL midnight (never UTC, so a date never shifts a day in negative-offset timezones); `allDay` items land in the week and day all-day lanes. Month view can render adjacent-month days muted with `outsideDays="muted"`, and `renderDayHeader` puts consumer content (per-day counts, summaries) in month and week day headers. Date-scoped consumers set `granularity="day"` to drop the hour grid: week becomes one lane per day and day becomes a flat agenda list. `scroll="page"` gives the calendar to the document — natural height, ONE page-owned vertical scroll, and the week grid keeps a single horizontal bounded-overflow with the pinned always-visible scrollbar (the workspace-board treatment); the default `contained` keeps the grid viewport-fit for height-bound layouts. Pass a fixed `now` for deterministic today marking.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'interaction', 'overflow', 'dense-data', 'long-labels'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

interface CalendarGridCanonicalArgs {
  /** Zoom level: month day grid, week hour-by-day grid, or day agenda. */
  view: 'month' | 'week' | 'day'
  /** Month view: hide adjacent-month days or render them muted. */
  outsideDays: 'hidden' | 'muted'
  /** `day` drops the hour grid for date-scoped calendars. */
  granularity: 'hour' | 'day'
  /** Opt-in dimming for days that precede `now`. */
  dimPastDays: boolean
}

export const CanonicalUsage = {
  parameters: { layout: 'padded' },
  args: {
    view: 'month',
    outsideDays: 'hidden',
    granularity: 'hour',
    dimPastDays: false,
  },
  // No meta `component` (CalendarGrid is generic over its item type), so the
  // knobs declare themselves. The date fixture stays pinned for determinism.
  argTypes: {
    view: { control: 'select', options: ['month', 'week', 'day'] },
    outsideDays: { control: 'select', options: ['hidden', 'muted'] },
    granularity: { control: 'select', options: ['hour', 'day'] },
    dimPastDays: { control: 'boolean' },
  },
  render: (args: CalendarGridCanonicalArgs) => (
    <CalendarGrid
      view={args.view}
      outsideDays={args.outsideDays}
      granularity={args.granularity}
      dimPastDays={args.dimPastDays}
      date={new Date(2026, 6, 15)}
      now={new Date(2026, 6, 15, 9, 30)}
      label="July 2026 releases"
      items={[
        { key: 'standup', date: new Date(2026, 6, 15, 9, 0), title: 'Design standup' },
        { key: 'review', date: new Date(2026, 6, 15, 14, 0), title: 'Roadmap review' },
        { key: 'ship', date: new Date(2026, 6, 21, 11, 0), title: 'Ship v2.4' },
      ]}
      renderItem={(item) => <span>{item.title}</span>}
    />
  ),
  play: async ({ canvas, args }) => {
    const root =
      args.view === 'day'
        ? canvas.getByRole('region', { name: 'July 2026 releases' })
        : canvas.getByRole('grid', { name: 'July 2026 releases' })
    await expect(root).toBeVisible()
    if (args.view === 'month') {
      await expect(canvas.getByRole('gridcell', { name: 'Wednesday, July 15, 2 items' })).toBeVisible()
      await expect(canvas.getByText('Ship v2.4')).toBeVisible()
    } else {
      await expect(canvas.getByText('Design standup')).toBeVisible()
    }
  },
} satisfies StoryObj<CalendarGridCanonicalArgs>

interface DemoItem {
  key: string
  date?: Date
  allDay?: boolean
  title: string
}

function DemoChip({ title }: { title: string }) {
  return (
    <span
      style={{
        display: 'block',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        marginBottom: 'var(--bakin-layout-space-1)',
        padding: 'var(--bakin-layout-space-1) var(--bakin-layout-space-2)',
        borderRadius: 'var(--bakin-radius-control)',
        background: 'var(--bakin-color-surface-default)',
        border: '1px solid var(--bakin-color-border-subtle)',
        fontSize: 'var(--bakin-typography-size-meta)',
        color: 'var(--bakin-color-text-primary)',
      }}
    >
      {title}
    </span>
  )
}

const weekItems: DemoItem[] = [
  { key: 'kickoff', date: new Date(2026, 6, 13, 9, 0), title: 'Sprint kickoff' },
  { key: 'triage', date: new Date(2026, 6, 14, 9, 0), title: 'Inbox triage' },
  { key: 'sync', date: new Date(2026, 6, 15, 10, 0), title: 'Runtime sync with the entire platform working group' },
  { key: 'metrics', date: new Date(2026, 6, 15, 10, 0), title: 'Metrics rollup' },
  { key: 'publish', date: new Date(2026, 6, 16, 15, 0), title: 'Publish newsletter' },
  { key: 'launch-day', date: new Date(2026, 6, 17, 0, 0), allDay: true, title: 'Launch day' },
]

const dayItems: DemoItem[] = [
  { key: 'standup', date: new Date(2026, 6, 15, 9, 0), title: 'Design standup' },
  { key: 'sync', date: new Date(2026, 6, 15, 10, 0), title: 'Runtime sync' },
  { key: 'review', date: new Date(2026, 6, 15, 14, 0), title: 'Roadmap review' },
  { key: 'focus', date: new Date(2026, 6, 15, 14, 30), title: 'Focus block' },
  { key: 'offsite', date: new Date(2026, 6, 15, 0, 0), allDay: true, title: 'Team offsite prep' },
]

export const WeekAndDayStructure = {
  render: () => (
    <StoryStage
      width="wide"
      eyebrow="Lists / calendar structure"
      title="One structure for week and day zoom levels"
      description="The week view is an hour-by-day grid with an all-day lane and sticky day headers; the day view is an hour-row agenda with the current hour marked. Item content stays consumer-owned."
    >
      <StorySection
        title="Week — hour × day grid"
        description="Wide weeks scroll inside the grid's own bounded overflow; the all-day lane appears only when an all-day item exists."
      >
        <CalendarGrid
          view="week"
          date={new Date(2026, 6, 15)}
          now={new Date(2026, 6, 15, 10, 30)}
          label="Week of July 12, 2026"
          items={weekItems}
          renderItem={(item) => <DemoChip title={item.title} />}
        />
      </StorySection>
      <StorySection
        title="Day — hour-row agenda"
        description="The current hour is marked from the deterministic `now` instant."
      >
        <CalendarGrid
          view="day"
          date={new Date(2026, 6, 15)}
          now={new Date(2026, 6, 15, 10, 30)}
          label="Wednesday, July 15, 2026"
          items={dayItems}
          renderItem={(item) => <DemoChip title={item.title} />}
        />
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const week = canvas.getByRole('grid', { name: 'Week of July 12, 2026' })
    await expect(week).toBeVisible()
    await expect(canvas.getByRole('gridcell', { name: 'Wednesday, July 15, 10 AM, 2 items' })).toBeVisible()
    await expect(canvas.getByRole('gridcell', { name: 'Friday, July 17, all day, 1 item' })).toBeVisible()
    const day = canvas.getByRole('region', { name: 'Wednesday, July 15, 2026' })
    await expect(day).toBeVisible()
    await expect(day.querySelector('[data-current-hour]')).toHaveTextContent('10 AM')
  },
} satisfies Story

const busyMonthItems: DemoItem[] = [
  { key: 'a', date: new Date(2026, 6, 15, 8, 0), title: 'Morning brief' },
  { key: 'b', date: new Date(2026, 6, 15, 9, 0), title: 'Design standup' },
  { key: 'c', date: new Date(2026, 6, 15, 11, 0), title: 'Roadmap review' },
  { key: 'd', date: new Date(2026, 6, 15, 14, 0), title: 'Metrics rollup' },
  { key: 'e', date: new Date(2026, 6, 15, 16, 0), title: 'Publish newsletter' },
  { key: 'f', date: new Date(2026, 6, 21, 11, 0), title: 'Ship v2.4' },
]

export const OverflowAndKeyboard = {
  render: () => (
    <StoryStage
      eyebrow="Lists / calendar structure"
      title="Overflow disclosure and cell keyboard navigation"
      description="Month days show a bounded stack with a +N more disclosure. One tab stop serves the whole grid: arrows move by cell, Home/End jump within the row, Enter enters the cell's first item."
    >
      <StorySection title="Busy month" description="July 15 holds five items; two sit behind the disclosure.">
        <CalendarGrid
          view="month"
          date={new Date(2026, 6, 1)}
          now={new Date(2026, 6, 10, 9, 0)}
          label="July 2026 busy calendar"
          items={busyMonthItems}
          renderItem={(item) => <DemoChip title={item.title} />}
        />
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.queryByText('Publish newsletter')).toBeNull()
    const disclosure = canvas.getByRole('button', { name: '+2 more' })
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(disclosure)
    await expect(canvas.getByText('Publish newsletter')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')

    const cell = canvas.getByRole('gridcell', { name: 'Wednesday, July 15, 5 items' })
    cell.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('gridcell', { name: 'Thursday, July 16, no items' })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    await expect(canvas.getByRole('gridcell', { name: 'Thursday, July 9, no items' })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    await expect(canvas.getByRole('gridcell', { name: 'Sunday, July 5, no items' })).toHaveFocus()
  },
} satisfies Story

// Date-scoped planning items — plain YYYY-MM-DD strings, parsed by the kit as
// LOCAL midnight (never UTC).
const planItems = [
  { key: 'retro', date: '2026-06-30', title: 'June retro recap' },
  { key: 'teaser', date: '2026-07-03', title: 'Teaser post' },
  { key: 'launch-post', date: '2026-07-15', title: 'Launch post' },
  { key: 'thread', date: '2026-07-15', title: 'Behind-the-scenes thread' },
  { key: 'newsletter', date: '2026-07-15', title: 'Newsletter' },
  { key: 'recap', date: '2026-07-17', title: 'Launch recap' },
]

function localDateKey(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

function PostCount({ day }: { day: Date }) {
  const count = planItems.filter((item) => item.date === localDateKey(day)).length
  if (count === 0) return null
  return (
    <span
      style={{ fontSize: 'var(--bakin-typography-size-meta)', color: 'var(--bakin-color-text-primary)' }}
    >
      {count === 1 ? '1 post' : `${count} posts`}
    </span>
  )
}

export const DateScopedPlanning = {
  render: () => (
    <StoryStage
      width="wide"
      eyebrow="Lists / calendar structure"
      title="Date-scoped calendars: outside days, counts, past dimming, day granularity"
      description="Content-planning items carry dates, not times. The month view renders adjacent-month days muted with outsideDays, dims elapsed days with the opt-in dimPastDays, and puts per-day counts in the renderDayHeader slot. granularity=day drops the hour grid: the week becomes one lane per day and the day view becomes a flat agenda list."
    >
      <StorySection
        title="Month — outside days, counts, and past dimming"
        description="Plain YYYY-MM-DD items parse as local dates. June 30 renders as a muted outside day with its item placed; days before the fixed now are dimmed."
      >
        <CalendarGrid
          view="month"
          date={new Date(2026, 6, 1)}
          now={new Date(2026, 6, 15, 9, 0)}
          label="July 2026 content plan"
          items={planItems}
          outsideDays="muted"
          dimPastDays
          renderDayHeader={(day) => <PostCount day={day} />}
          renderItem={(item) => <DemoChip title={item.title} />}
        />
      </StorySection>
      <StorySection
        title="Week — one lane per day"
        description="granularity=day removes the hour rows and the time gutter; each day is a single lane."
      >
        <CalendarGrid
          view="week"
          date={new Date(2026, 6, 15)}
          now={new Date(2026, 6, 15, 9, 0)}
          label="Week of July 12 plan"
          items={[
            { key: 'launch-post', date: '2026-07-15', title: 'Launch post' },
            { key: 'thread', date: '2026-07-15', title: 'Behind-the-scenes thread' },
            { key: 'recap', date: '2026-07-17', title: 'Launch recap' },
          ]}
          granularity="day"
          renderItem={(item) => <DemoChip title={item.title} />}
        />
      </StorySection>
      <StorySection
        title="Today — flat agenda list"
        description="The day view with granularity=day is a flat list of the day's items in input order."
      >
        <CalendarGrid
          view="day"
          date={new Date(2026, 6, 15)}
          now={new Date(2026, 6, 15, 9, 0)}
          label="Today's plan"
          items={planItems}
          granularity="day"
          renderItem={(item) => <DemoChip title={item.title} />}
        />
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    // Outside day rendered muted with its item placed and its count slotted.
    const outside = canvas.getByRole('gridcell', { name: 'Tuesday, June 30, 1 item' })
    await expect(outside).toBeVisible()
    await expect(outside).toHaveAttribute('data-outside')
    await expect(canvas.getByText('June retro recap')).toBeVisible()
    // Day-header count slot ("3 posts" on July 15).
    await expect(canvas.getByText('3 posts')).toBeVisible()
    // Past day marked; dimming is the opt-in dimPastDays.
    await expect(canvas.getByRole('gridcell', { name: 'Friday, July 3, 1 item' })).toHaveAttribute('data-past')
    // '2026-07-15' lands on July 15 — local parsing, never the UTC previous day.
    await expect(canvas.getByRole('gridcell', { name: 'Wednesday, July 15, 3 items' })).toBeVisible()
    // Week lanes: no hour grid, one gridcell per day.
    const week = canvas.getByRole('grid', { name: 'Week of July 12 plan' })
    await expect(week).toHaveAttribute('data-granularity', 'day')
    await expect(canvas.queryByRole('rowheader', { name: '12 AM' })).toBeNull()
    await expect(canvas.getByRole('gridcell', { name: 'Wednesday, July 15, 2 items' })).toBeVisible()
    // Flat today list keeps only the anchor day's items.
    const today = canvas.getByRole('region', { name: "Today's plan" })
    await expect(today).toHaveAttribute('data-granularity', 'day')
    await expect(today).toHaveTextContent('Newsletter')
    await expect(today).not.toHaveTextContent('Launch recap')
  },
} satisfies Story
