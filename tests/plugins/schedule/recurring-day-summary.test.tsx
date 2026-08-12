// @vitest-environment jsdom
import { describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'

import '../../rtl-settle'

import { RecurringDaySummary } from '../../../plugins/schedule/components/recurring-day-summary'

describe('RecurringDaySummary', () => {
  it('presents a compact recurring-series summary as one named action', () => {
    const onClick = mock(() => {})

    render(
      <RecurringDaySummary
        title="Hourly Inbox Sync"
        detail="13 done · 11 scheduled"
        leading={<span aria-hidden="true">R</span>}
        onClick={onClick}
      />,
    )

    // Kit CalendarItem binding: the visible title + detail ARE the
    // accessible name — no parallel aria-label to drift.
    const summary = screen.getByRole('button', {
      name: /Hourly Inbox Sync/,
    })
    expect(summary.textContent).toContain('13 done · 11 scheduled')
    fireEvent.click(summary)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(summary.getAttribute('data-slot')).toBe('calendar-item')
    expect(summary.getAttribute('data-tone')).toBe('neutral')
  })

  it('exposes an attention state without relying on color alone', () => {
    render(
      <RecurringDaySummary
        title="Hourly Inbox Sync"
        detail="23 done · 1 skipped"
        tone="attention"
      />,
    )

    const summary = screen.getByRole('button', { name: /Hourly Inbox Sync/ })
    expect(summary.getAttribute('data-tone')).toBe('attention')
    // Marker status is screen-reader text, never a title tooltip.
    expect(screen.getByText('Needs attention').className).toContain('sr-only')
  })
})
