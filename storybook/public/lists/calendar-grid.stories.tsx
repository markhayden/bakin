import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { CalendarGrid } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Lists/CalendarGrid',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'CalendarGrid is the shared calendar structure behind month (7-column day grid), week (hour-by-day grid with an all-day lane), and day (hour-row agenda) views. The kit owns grid geometry, day and hour headers, today and current-hour marking, past-day dimming, roving keyboard cell navigation (arrows move, Home/End jump within the row, Enter enters the cell\'s first item), and the month overflow disclosure. Consumers own every item — chips, cards, popovers, drag — via `renderItem`, plus range navigation controls (previous/next/today) and item ordering, which is preserved per cell. Items are placed by their local `date`/`start` instant; `allDay` items land in the week and day all-day lanes. Pass a fixed `now` for deterministic today marking.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'interaction', 'overflow', 'dense-data', 'long-labels'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'padded' },
  render: () => (
    <CalendarGrid
      view="month"
      date={new Date(2026, 6, 1)}
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
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('grid', { name: 'July 2026 releases' })).toBeVisible()
    await expect(canvas.getByRole('gridcell', { name: 'Wednesday, July 15, 2 items' })).toBeVisible()
    await expect(canvas.getByText('Ship v2.4')).toBeVisible()
  },
} satisfies Story

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
