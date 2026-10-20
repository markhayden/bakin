// @vitest-environment jsdom
/**
 * ScheduleInput (#966b): clearing the value drops the last parse in the same
 * render (no stale "Every day…" under an empty field) and tells the owner.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { ScheduleInput } from '../../../plugins/schedule/components/schedule-input'

const originalFetch = globalThis.fetch
beforeEach(() => {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    if (String(input).includes('/api/plugins/schedule/parse')) return Response.json({ kind: 'cron', expr: '0 9 * * *', human: 'Every day at 9:00 AM', next: [] })
    return Response.json({}, { status: 404 })
  }) as unknown as typeof fetch
})
afterEach(() => { cleanup(); globalThis.fetch = originalFetch })

describe('ScheduleInput', () => {
  it('an emptied value drops the parse immediately and reports null', async () => {
    const onParsed = mock(() => {})
    const view = render(<ScheduleInput value="0 9 * * *" onChange={() => {}} onParsed={onParsed} />)
    await waitFor(() => expect(screen.getByText('Every day at 9:00 AM')).toBeDefined(), { timeout: 3000 })
    await act(async () => { view.rerender(<ScheduleInput value="" onChange={() => {}} onParsed={onParsed} />) })
    expect(screen.queryByText('Every day at 9:00 AM')).toBeNull()
    expect(onParsed).toHaveBeenLastCalledWith(null)
  })
})
