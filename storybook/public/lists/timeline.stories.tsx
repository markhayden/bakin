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
        component: 'Timeline is the sanctioned feed type for chronological activity: an ordered list whose entries share a StatusMarker rail and a timestamp gutter. Each entry carries timestamp + status + title, optional meta chips, optional detail, an optional keyboard-accessible disclosure (Collapsible composition), and optional nested child entries for events subordinate to a parent (audit records inside a dispatch attempt). Status tones are always paired with visible status text — the rail is reinforcement, never the only signal. Entry order is the meaning; newest-first or oldest-first stays a consumer decision. Narrow containers wrap meta onto its own row and compact status chips to xs metrics, keeping every entry two predictable lines; wide containers move the timestamp into the left gutter and keep meta inline. note carries a short qualifying reason — a settle reason, a failure cause — rail-attached with a tone-colored start rule and no box, because the spine is already the boundary and a second outline reads as a detached widget; reserve a boxed Alert for a note that should interrupt the feed on purpose. An entry without a timestamp does not reserve the gutter, and a nested timeline keeps its times inline so it never re-creates the parent column at a different offset.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'keyboard', 'non-color'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

interface TimelineCanonicalArgs {
  /** StatusMarker tone on the first entry's rail. */
  tone: 'neutral' | 'success' | 'danger' | 'attention' | 'accent'
  /** Collapse the first entry's detail behind a keyboard-operable disclosure. */
  expandable: boolean
}

export const CanonicalUsage = {
  parameters: { layout: 'padded' },
  args: {
    tone: 'success',
    expandable: false,
  },
  // TimelineEntry carries the knobs (the Timeline root has no visual props),
  // so the controls declare themselves against the first entry.
  argTypes: {
    tone: { control: 'select', options: ['neutral', 'success', 'danger', 'attention', 'accent'] },
    expandable: { control: 'boolean' },
  },
  render: (args: TimelineCanonicalArgs) => (
    <Timeline aria-label="Recent activity">
      <TimelineEntry
        timestamp="09:41"
        dateTime="2026-07-29T09:41:00Z"
        tone={args.tone}
        expandable={args.expandable}
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
  play: async ({ canvas, args }) => {
    const feed = canvas.getByRole('list', { name: 'Recent activity' })
    await expect(feed).toBeVisible()
    await expect(feed.tagName).toBe('OL')
    const entries = canvas.getAllByRole('listitem')
    await expect(entries).toHaveLength(2)
    await expect(entries[0]).toHaveAttribute('data-tone', args.tone)
    if (args.expandable) {
      await expect(canvas.getByRole('button', { name: /Catalog refreshed/ })).toHaveAttribute('aria-expanded', 'false')
    } else {
      await expect(canvas.getByText('24 records indexed without errors.')).toBeVisible()
    }
  },
} satisfies StoryObj<TimelineCanonicalArgs>

export const StatusRailExpansionNesting = {
  render: () => (
    <StoryStage
      eyebrow="Lists / feeds"
      title="Chronological activity with an honest status rail"
      description="Every entry pairs the rail tone with visible status text. A qualifying note hangs off the rail in the entry own tone rather than sitting in a box, detail collapses behind a keyboard-operable disclosure, and related events nest inside the attempt that produced them."
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
            timestamp="09:33"
            dateTime="2026-07-29T09:33:00Z"
            tone="danger"
            title="Compile weekly engagement metrics"
            meta={<StatusBadge tone="danger" size="xs">Failed</StatusBadge>}
            noteLabel="Failure reason"
            note="session-death"
          >
            Attempt 1 · Rolo · 5m 0s
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

    // Non-color: every rail tone is paired with visible status text. Two
    // entries carry the danger tone (one expandable, one with a note), so
    // assert on the set rather than a single match.
    const failed = canvas.getAllByText('Failed')
    await expect(failed).toHaveLength(2)
    for (const badge of failed) await expect(badge).toBeVisible()
    await expect(canvas.getByText('Completed')).toBeVisible()
    // The note states the reason in text, not by rule color alone.
    await expect(canvas.getByText(/Failure reason:\s*session-death/)).toBeVisible()
  },
} satisfies Story
