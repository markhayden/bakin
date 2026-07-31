import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { StatusBadge, Timeline, TimelineEntry } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Lists/Timeline',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Timeline is the sanctioned feed type for chronological activity: an ordered list whose entries share a StatusMarker rail and a timestamp gutter. Each entry carries timestamp + status + title, optional meta chips, optional detail, an optional keyboard-accessible disclosure (Collapsible composition), and optional nested child entries for events subordinate to a parent (audit records inside a dispatch attempt). Status tones are always paired with visible status text — the rail is reinforcement, never the only signal. Entry order is the meaning; newest-first or oldest-first stays a consumer decision.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'keyboard', 'non-color'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'padded' },
  render: () => (
    <Timeline aria-label="Recent activity">
      <TimelineEntry
        timestamp="09:41"
        dateTime="2026-07-29T09:41:00Z"
        tone="success"
        title="Catalog refreshed"
      >
        24 records indexed without errors.
      </TimelineEntry>
      <TimelineEntry
        timestamp="09:12"
        dateTime="2026-07-29T09:12:00Z"
        tone="danger"
        title="Health endpoint failure"
      >
        Endpoint not found (HTTP 404).
      </TimelineEntry>
    </Timeline>
  ),
  play: async ({ canvas }) => {
    const feed = canvas.getByRole('list', { name: 'Recent activity' })
    await expect(feed).toBeVisible()
    await expect(feed.tagName).toBe('OL')
    await expect(canvas.getAllByRole('listitem')).toHaveLength(2)
  },
} satisfies Story

export const StatusRailExpansionNesting = {
  render: () => (
    <StoryStage
      eyebrow="Lists / feeds"
      title="Chronological activity with an honest status rail"
      description="Every entry pairs the rail tone with visible status text. Detail collapses behind a keyboard-operable disclosure, and related events nest inside the attempt that produced them."
    >
      <StorySection title="Dispatch activity">
        <Timeline aria-label="Dispatch activity">
          <TimelineEntry
            timestamp="09:41"
            dateTime="2026-07-29T09:41:00Z"
            tone="success"
            title="Publish launch announcement"
            meta={<StatusBadge tone="success" size="xs">Completed</StatusBadge>}
          >
            Attempt 3 · Margo · 4m 12s
          </TimelineEntry>
          <TimelineEntry
            timestamp="09:12"
            dateTime="2026-07-29T09:12:00Z"
            tone="danger"
            title="Corrective re-dispatch after session death"
            meta={<StatusBadge tone="danger" size="xs">Failed</StatusBadge>}
            expandable
          >
            The runtime session died mid-turn; salvaged output was saved as an
            asset before the corrective re-dispatch was queued.
          </TimelineEntry>
          <TimelineEntry
            timestamp="08:56"
            dateTime="2026-07-29T08:56:00Z"
            tone="accent"
            title="Reconcile provider usage across every configured runtime adapter"
            meta={<StatusBadge tone="accent" size="xs">Running</StatusBadge>}
          >
            Attempt 1 · Pixel · in flight
            <Timeline nested aria-label="Related events">
              <TimelineEntry
                timestamp="08:57"
                dateTime="2026-07-29T08:57:00Z"
                tone="neutral"
                title="Task routed"
              >
                Routed to Pixel via team resolution.
              </TimelineEntry>
              <TimelineEntry
                timestamp="08:58"
                dateTime="2026-07-29T08:58:00Z"
                tone="neutral"
                title="Worktree created"
              >
                bakin/run/task-482-d1
              </TimelineEntry>
            </Timeline>
          </TimelineEntry>
        </Timeline>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas, userEvent }) => {
    // Ordered-list semantics survive at both levels.
    const feed = canvas.getByRole('list', { name: 'Dispatch activity' })
    await expect(feed.tagName).toBe('OL')
    const nested = canvas.getByRole('list', { name: 'Related events' })
    await expect(nested.tagName).toBe('OL')
    await expect(within(nested).getAllByRole('listitem')).toHaveLength(2)

    // Keyboard expansion via the Collapsible composition.
    const trigger = canvas.getByRole('button', { name: /Corrective re-dispatch/ })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText(/salvaged output was saved/)).toBeVisible()

    // Non-color: the rail tone is always paired with visible status text.
    await expect(canvas.getByText('Failed')).toBeVisible()
    await expect(canvas.getByText('Completed')).toBeVisible()
  },
} satisfies Story
