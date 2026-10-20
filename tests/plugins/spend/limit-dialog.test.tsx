// @vitest-environment jsdom
/**
 * LimitDialog (#966b): the draft belongs to one opening — keyed by `open`,
 * so a dismissed dialog's numbers never reappear as if chosen, and the
 * coverage suggestion prefills the fresh draft again.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { LimitDialog } from '../../../plugins/spend/components/limit-dialog'

const lane = { meteredUsdMicros: 0, meteredTokens: 0, subscriptionTokens: 0 }
const scope = { ...lane, unattributed: { meteredUsdMicros: 0, meteredTokens: 0, subscriptionTokens: 0 } }
const window = { startMs: 0, global: { ...scope, meteredUsdMicros: 12_500_000, meteredTokens: 1_000 }, byAgent: {}, byProvider: {}, byModel: {} }
const coverage = {
  lookbackDays: 30, computedAt: 1, coveredDays: Array.from({ length: 14 }, (_, i) => `2026-09-${String(8 + i).padStart(2, '0')}`), uncoveredDays: [],
  covered: { window: { ...window, global: { ...scope, meteredUsdMicros: 140_000_000 } } },
  uncovered: { window: { ...window, global: { ...scope, meteredUsdMicros: 5_000_000 } } },
  suggestion: { status: 'ready', monthlyUsd: 450, basis: { coveredDays: 14, coveredUsdMicros: 140_000_000, dailyRateUsdMicros: 10_000_000 }, unobservedUsdMicros: 5_000_000 },
}
const originalFetch = globalThis.fetch
let coverageReads = 0
beforeEach(() => {
  coverageReads = 0
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    if (String(input).includes('/api/plugins/spend/coverage')) { coverageReads += 1; return Response.json(coverage) }
    return Response.json({}, { status: 404 })
  }) as unknown as typeof fetch
})
afterEach(() => { globalThis.fetch = originalFetch })

describe('LimitDialog', () => {
  it('each opening starts from a clean draft and reads coverage again; the typed number from a dismissed opening never comes back', async () => {
    const props = { onOpenChange: () => {}, onSave: async () => {}, agents: [], providers: [] }
    const view = render(<LimitDialog open {...props} />)
    const monthly = () => screen.getByLabelText('Monthly limit (USD)') as HTMLInputElement
    await waitFor(() => expect(monthly().value).toBe('450'))
    expect(coverageReads).toBe(1)
    await act(async () => { fireEvent.change(monthly(), { target: { value: '999' } }) })
    expect(monthly().value).toBe('999')

    view.rerender(<LimitDialog open={false} {...props} />)
    view.rerender(<LimitDialog open {...props} />)
    // Fresh draft in the same render the dialog reopens — before the new coverage read lands.
    expect(monthly().value).toBe('')
    await waitFor(() => expect(monthly().value).toBe('450'))
    expect(coverageReads).toBe(2)
  })
})
