// @vitest-environment jsdom

import { describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { StatusBadge, Timeline, TimelineEntry } from '@makinbakin/sdk/patterns'
import '../../rtl-settle'

describe('Timeline', () => {
  it('renders ordered-list semantics with a status rail and timestamp gutter', () => {
    render(
      <Timeline aria-label="Recent activity">
        <TimelineEntry
          timestamp="09:41"
          dateTime="2026-07-29T09:41:00Z"
          tone="success"
          title="Catalog refreshed"
        >
          24 records indexed.
        </TimelineEntry>
        <TimelineEntry timestamp="09:12" dateTime="2026-07-29T09:12:00Z" tone="danger" title="Health endpoint failure" />
      </Timeline>,
    )

    const feed = screen.getByRole('list', { name: 'Recent activity' })
    expect(feed.tagName).toBe('OL')
    expect(feed.getAttribute('data-slot')).toBe('timeline')
    expect(feed.className).toContain('@container/timeline')

    const entries = screen.getAllByRole('listitem')
    expect(entries).toHaveLength(2)
    const first = entries[0] as HTMLElement
    expect(first.getAttribute('data-slot')).toBe('timeline-entry')
    expect(first.getAttribute('data-tone')).toBe('success')

    // Timestamp renders twice — inline (narrow) and in the gutter (wide) —
    // with the machine-readable dateTime on both.
    const times = first.querySelectorAll('time')
    expect(times).toHaveLength(2)
    for (const time of times) {
      expect(time.getAttribute('datetime')).toBe('2026-07-29T09:41:00Z')
    }

    const rail = first.querySelector('[data-slot="timeline-rail"]')
    expect(rail?.querySelector('[data-status-marker="success"]')).toBeTruthy()
    // The connecting line hides on the last entry via group-last styling.
    expect(rail?.querySelector('[data-slot="timeline-rail-line"]')?.className).toContain('group-last/timeline-entry:hidden')

    expect(first.querySelector('[data-slot="timeline-entry-body"]')?.textContent).toBe('24 records indexed.')
  })

  it('supports meta chips, marker labels, and custom markers', () => {
    render(
      <Timeline aria-label="Steps">
        <TimelineEntry
          timestamp="1"
          title="Draft"
          tone="attention"
          markerLabel="Needs review"
          meta={<StatusBadge tone="attention">In review</StatusBadge>}
        />
        <TimelineEntry title="Publish" marker={<span data-step-number="">2</span>} />
      </Timeline>,
    )

    expect(screen.getByRole('img', { name: 'Needs review' })).toBeDefined()
    expect(screen.getByText('In review')).toBeDefined()
    const second = screen.getAllByRole('listitem')[1] as HTMLElement
    expect(second.querySelector('[data-step-number]')).toBeTruthy()
    expect(second.querySelector('[data-status-marker]')).toBeNull()
  })

  it('collapses detail behind a keyboard-accessible disclosure when expandable', () => {
    const onExpandedChange = mock(() => {})
    render(
      <Timeline aria-label="Dispatch activity">
        <TimelineEntry
          timestamp="09:12"
          tone="danger"
          title="Corrective re-dispatch"
          expandable
          onExpandedChange={onExpandedChange}
        >
          Salvaged output saved as an asset.
        </TimelineEntry>
      </Timeline>,
    )

    const trigger = screen.getByRole('button', { name: /Corrective re-dispatch/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Salvaged output saved as an asset.')).toBeNull()

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(onExpandedChange).toHaveBeenCalledWith(true)
    expect(screen.getByText('Salvaged output saved as an asset.')).toBeDefined()
  })

  it('nests related entries as a subordinate ordered list inside a parent entry', () => {
    render(
      <Timeline aria-label="Dispatch activity">
        <TimelineEntry timestamp="08:56" tone="accent" title="Reconcile provider usage">
          Attempt 1 · in flight
          <Timeline nested aria-label="Related events">
            <TimelineEntry timestamp="08:57" title="Task routed" />
            <TimelineEntry timestamp="08:58" title="Worktree created" />
          </Timeline>
        </TimelineEntry>
      </Timeline>,
    )

    const parent = screen.getByRole('list', { name: 'Dispatch activity' })
    const nested = within(parent).getByRole('list', { name: 'Related events' })
    expect(nested.tagName).toBe('OL')
    expect(nested.getAttribute('data-nested')).toBe('')
    expect(nested.className).not.toContain('@container/timeline')
    expect(within(nested).getAllByRole('listitem')).toHaveLength(2)
    expect(nested.closest('[data-slot="timeline-entry"]')).toBeTruthy()
  })
})
