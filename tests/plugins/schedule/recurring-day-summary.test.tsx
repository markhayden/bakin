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

    const summary = screen.getByRole('button', {
      name: 'Hourly Inbox Sync. 13 done · 11 scheduled',
    })
    fireEvent.click(summary)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(summary.getAttribute('data-tone')).toBe('neutral')
    expect(summary.className).toContain('grid-cols-[auto_minmax(0,1fr)_auto]')
    expect(summary.className).toContain('gap-x-bakin-2')
    expect(screen.getByText('R').parentElement?.className).toContain('size-bakin-6')
  })

  it('exposes an attention state without relying on color alone', () => {
    render(
      <RecurringDaySummary
        title="Hourly Inbox Sync"
        detail="23 done · 1 skipped"
        tone="attention"
      />,
    )

    const summary = screen.getByRole('button', {
      name: 'Hourly Inbox Sync. 23 done · 1 skipped',
    })
    expect(summary.getAttribute('data-tone')).toBe('attention')
    expect(screen.getByTitle('Needs attention')).toBeDefined()
  })
})
