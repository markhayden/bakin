// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import type { UsageFeedData } from '../../../plugins/health/types'
import type { UseHealthResourceResult } from '../../../plugins/health/hooks/use-health-resource'
import '../../rtl-settle'

mock.module('@makinbakin/sdk/hooks', () => ({
  useQueryState: (_key: string, defaultValue: string) => useState(defaultValue),
}))

function activityData(): UseHealthResourceResult<UsageFeedData> {
  return {
  data: {
    totals: { count: 3, errors: 2, errorRate: 2 / 3 },
    topByName: [],
    byAgent: [],
    recent: [
      {
        ts: '2026-07-12T12:02:00.000Z', kind: 'rest', activityClass: 'routine',
        name: '/api/plugins/search/reindex', agent: null, durationMs: 340, status: 'error',
        meta: { statusCode: 500 },
      },
      {
        ts: '2026-07-12T12:01:00.000Z', kind: 'mcp', activityClass: 'user',
        name: 'bakin_exec_tasks_move', agent: 'main', durationMs: 80, status: 'error',
      },
      {
        ts: '2026-07-12T12:00:00.000Z', kind: 'agent', activityClass: 'user',
        name: 'dispatch', agent: 'patch', durationMs: 1200, status: 'ok',
      },
    ],
    timeBuckets: [
      { start: '2026-07-12T12:00:00.000Z', count: 1, failureCount: 0, failureRate: 0 },
      { start: '2026-07-12T12:05:00.000Z', count: 2, failureCount: 2, failureRate: 1 },
    ],
  },
  error: null,
  backgroundError: null,
  loading: false,
  refreshing: false,
  refresh: mock(async () => null),
  }
}

const useActivityDataMock = mock((_options: unknown) => activityData())

mock.module('../../../plugins/health/hooks/use-activity-data', () => ({
  useActivityData: useActivityDataMock,
}))

import { ActivityTab } from '../../../plugins/health/components/activity-tab'

beforeEach(() => {
  useActivityDataMock.mockClear()
  useActivityDataMock.mockImplementation((_options: unknown) => activityData())
})

afterEach(() => cleanup())

describe('ActivityTab', () => {
  it('leads with a plain failure decision and puts failures before the compact trend', () => {
    render(<ActivityTab />)

    const tab = screen.getByTestId('health-activity-tab')
    expect(within(tab).getByRole('heading', { level: 2, name: 'What failed recently?' })).toBeDefined()
    expect(within(tab).getByText('2 of 3 recorded activities failed.')).toBeDefined()
    expect(within(tab).queryByText('Failure rate')).toBeNull()

    const failures = within(tab).getByRole('heading', { name: 'Failures (2)' })
    const trend = within(tab).getByRole('heading', { name: 'Failures over time' })
    expect(failures.compareDocumentPosition(trend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const successfulActivity = within(tab).getByText('Successful activity (1)').closest('details')
    expect(successfulActivity?.open).toBe(false)
    fireEvent.click(within(tab).getByText('Successful activity (1)'))
    expect(successfulActivity?.open).toBe(true)

    expect(screen.getByText('Search Reindex')).toBeDefined()
    expect(screen.getAllByText('Technical details')).toHaveLength(3)
    expect(screen.getByText('/api/plugins/search/reindex')).toBeDefined()
    expect(screen.getByText(/tool call did not complete/i)).toBeDefined()
  })

  it('renders a compact failure-only trend with an exact accessible table', () => {
    render(<ActivityTab />)

    const chart = screen.getByRole('group', { name: 'Failures over time' })
    expect(chart.getAttribute('viewBox')).toBe('0 0 640 120')
    expect(chart.closest('[data-activity-failure-trend-plot]')?.className).toContain('max-w-4xl')

    const table = screen.getByRole('table', { name: 'Failures over time data' })
    expect(within(table).getByText('Failures')).toBeDefined()
    expect(within(table).queryByText('All activity')).toBeNull()
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(screen.getByRole('note').textContent).toContain('latest interval')
  })

  it('uses a calm zero-failure summary without empty chart or success sections', () => {
    const base = activityData()
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        totals: { count: 690, errors: 0, errorRate: 0 },
        recent: [],
        timeBuckets: [
          { start: '2026-07-12T12:00:00.000Z', count: 345, failureCount: 0, failureRate: 0 },
          { start: '2026-07-12T12:05:00.000Z', count: 345, failureCount: 0, failureRate: 0 },
        ],
      },
    }))

    render(<ActivityTab />)

    expect(screen.getByText('No failures in this window.')).toBeDefined()
    expect(screen.getByText('690 activities completed without a recorded failure.')).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Failures over time' })).toBeNull()
    expect(screen.queryByText(/Successful activity \(/)).toBeNull()
  })

  it('stores window, kind, and routine choices through URL-backed query state', () => {
    render(<ActivityTab />)

    fireEvent.change(screen.getByLabelText('Activity window'), { target: { value: '24h' } })
    fireEvent.change(screen.getByLabelText('Activity kind'), { target: { value: 'rest' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include routine success' }))

    expect(useActivityDataMock).toHaveBeenLastCalledWith({ window: '24h', kind: 'rest', includeRoutine: true })
  })

  it('keeps the Activity identity visible while its feed is loading', () => {
    useActivityDataMock.mockImplementation(() => ({
      ...activityData(),
      data: null,
      loading: true,
    }))

    render(<ActivityTab />)

    expect(screen.getByRole('heading', { level: 2, name: 'What failed recently?' })).toBeDefined()
    expect(screen.getByRole('status').textContent).toContain('Loading activity…')
  })

  it('keeps the Activity identity and recovery action visible when its feed fails', () => {
    useActivityDataMock.mockImplementation(() => ({
      ...activityData(),
      data: null,
      error: 'Activity feed unavailable',
    }))

    render(<ActivityTab />)

    expect(screen.getByRole('heading', { level: 2, name: 'What failed recently?' })).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('Activity feed unavailable')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined()
  })
})
