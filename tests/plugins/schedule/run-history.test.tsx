// @vitest-environment jsdom
/**
 * RunHistory (#966b): paging belongs to one job — showing another job starts
 * on page one in the same render, never a frame late.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '../../rtl-settle'
import * as realSdkHooks from '@makinbakin/sdk/hooks'
const runsFor = (jobId: string, count: number) => Array.from({ length: count }, (_, i) => ({
  id: `${jobId}-run-${i}`, jobId, status: 'success', startedAt: new Date(Date.UTC(2026, 9, 1 + i, 9)).toISOString(), finishedAt: new Date(Date.UTC(2026, 9, 1 + i, 9, 5)).toISOString(), taskId: `t-${i}`,
}))
mock.module('@makinbakin/sdk/hooks', () => ({
  ...realSdkHooks,
  useRunHistory: (jobId: string) => ({ runs: runsFor(jobId, jobId === 'job-a' ? 10 : 9), loading: false, refresh: () => {} }),
}))
import { RunHistory } from '../../../plugins/schedule/components/run-history'
afterEach(() => cleanup())

describe('RunHistory', () => {
  it('another job starts on page one', async () => {
    const view = render(<RunHistory jobId="job-a" />)
    const rows = () => within(screen.getByRole('list', { name: 'Recent scheduled job runs' })).getAllByRole('listitem')
    expect(rows()).toHaveLength(8)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })) })
    expect(rows()).toHaveLength(2)
    view.rerender(<RunHistory jobId="job-b" />)
    expect(rows()).toHaveLength(8)
  })
})
