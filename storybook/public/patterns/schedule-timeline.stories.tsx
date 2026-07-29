import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { PageShell, Stack } from '@makinbakin/sdk/layout'
import { RecurringDaySummary } from '@makinbakin/sdk/patterns'

import './schedule-timeline.stories.css'

const meta = {
  title: 'Patterns/Schedule and timeline',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'RecurringDaySummary keeps dense calendars readable by rolling a series with multiple daily occurrences into one compact day-header action. Single daily and ad-hoc work stays in its real time slot. Skipped or pending counts make the summary an attention state without adding every recurring beat back to the grid. Consumers own grouping, occurrence truth, and navigation.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'dense-data', 'long-labels', 'non-color', 'overflow'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const days = [
  { day: 'Sun', date: '26', title: 'Hourly Inbox Sync', detail: '24 done · 0 scheduled' },
  { day: 'Mon', date: '27', title: 'Hourly Inbox Sync', detail: '23 done · 1 skipped', tone: 'attention' as const },
  { day: 'Tue', date: '28', title: 'Hourly Inbox Sync', detail: '24 done · 0 scheduled' },
  { day: 'Wed', date: '29', title: 'Hourly Inbox Sync', detail: '13 done · 11 scheduled' },
  { day: 'Thu', date: '30', title: 'Hourly Inbox Sync', detail: '0 done · 24 scheduled' },
  { day: 'Fri', date: '31', title: 'Hourly Inbox Sync', detail: '0 done · 24 scheduled' },
  { day: 'Sat', date: '1', title: 'Hourly Inbox Sync', detail: '0 done · 24 scheduled' },
]

function RecurringCalendarDensityExample() {
  const [selection, setSelection] = useState('No recurring series selected')

  return (
    <main className="bakin-schedule-story">
      <PageShell width="wide">
        <Stack gap="section">
          <header className="bakin-schedule-story__intro">
            <p>Calendar / recurring density</p>
            <h1>Summarize the routine; place the one-off</h1>
            <p>
              A multi-run series appears once at the top of each day. One-off work
              remains in the hour grid, while skipped and pending counts stay visible
              in the summary without rendering twenty-four nearly identical cards.
            </p>
          </header>

          <section aria-labelledby="week-density-heading" className="bakin-schedule-story__section">
            <header>
              <h2 id="week-density-heading">Weekly density contract</h2>
              <p>Monday contains an exception, so its compact summary carries a visible non-color warning.</p>
            </header>

            <div className="bakin-schedule-story__overflow">
              <div className="bakin-schedule-story__week" role="group" aria-label="Recurring series by day">
                {days.map(day => (
                  <article key={`${day.day}-${day.date}`} className="bakin-schedule-story__day">
                    <header>
                      <span>{day.day}</span>
                      <strong>{day.date}</strong>
                    </header>
                    <RecurringDaySummary
                      title={day.title}
                      detail={day.detail}
                      tone={day.tone}
                      leading={<span aria-hidden="true" className="bakin-schedule-story__avatar">R</span>}
                      onClick={() => setSelection(`${day.day}: ${day.title}`)}
                    />
                    {day.tone === 'attention' ? (
                      <div className="bakin-schedule-story__exception">
                        <strong>2 AM · editorial review</strong>
                        <span>Separate one-off work keeps its real time</span>
                      </div>
                    ) : (
                      <div className="bakin-schedule-story__slot">
                        <span>Individual scheduled work remains here</span>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </div>

            <p className="bakin-schedule-story__status" role="status">{selection}</p>
          </section>
        </Stack>
      </PageShell>
    </main>
  )
}

export const RecurringCalendarDensity = {
  render: () => <RecurringCalendarDensityExample />,
  play: async ({ canvas, userEvent }) => {
    const mondaySummary = canvas.getByRole('button', {
      name: 'Hourly Inbox Sync. 23 done · 1 skipped',
    })
    await expect(mondaySummary).toHaveAttribute('data-tone', 'attention')
    await expect(canvas.getByTitle('Needs attention')).toBeVisible()
    await userEvent.click(mondaySummary)
    await expect(canvas.getByRole('status')).toHaveTextContent('Mon: Hourly Inbox Sync')
  },
} satisfies Story
