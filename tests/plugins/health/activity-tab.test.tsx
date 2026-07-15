// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { UsageFeedData } from '../../../plugins/health/types'
import type { UseHealthResourceResult } from '../../../plugins/health/hooks/use-health-resource'
import '../../rtl-settle'

const queryInitialValues = new Map<string, string>()
const queryWrites: Array<{ key: string; value: string }> = []

mock.module('@makinbakin/sdk/hooks', () => ({
  useQueryState: (key: string, defaultValue: string) => {
    const [value, setValue] = useState(queryInitialValues.get(key) ?? defaultValue)
    const writeValue = (next: string) => {
      queryWrites.push({ key, value: next })
      setValue(next)
    }
    return [value, writeValue, writeValue]
  },
}))

function activityData(): UseHealthResourceResult<UsageFeedData> {
  return {
    data: {
      window: '1h',
      capabilities: { exactFailureTargeting: true, sourceBalancedActivity: true },
      coverage: {
        startsAt: '2026-07-12T11:10:00.000Z',
        hasFullWindow: true,
        reason: 'full_window',
      },
      totals: { count: 3, errors: 2, errorRate: 2 / 3 },
      outcomes: { failed: 2, unverified: 0, canceled: 0, succeeded: 1 },
      byKind: [
        { kind: 'rest', total: 1, failures: 1 },
        { kind: 'mcp', total: 1, failures: 1 },
        { kind: 'agent', total: 1, failures: 0 },
      ],
      failureGroups: [
        {
          kind: 'rest', name: '/api/plugins/search/reindex', destination: '/api/plugins/search/reindex', method: null,
          attempts: 1, failures: 1,
          firstFailureAt: '2026-07-12T12:02:00.000Z', lastFailureAt: '2026-07-12T12:02:00.000Z',
          agents: [], unattributedFailures: 0, systemFailures: 1, medianFailureDurationMs: 340,
          latestFailure: {
            id: 'usage-rest-failure',
            ts: '2026-07-12T12:02:00.000Z', kind: 'rest', activityClass: 'routine',
            name: '/api/plugins/search/reindex', agent: null, durationMs: 340, status: 'error',
            meta: { statusCode: 500 },
          },
        },
        {
          kind: 'mcp', name: 'bakin_exec_tasks_move', destination: 'bakin_exec_tasks_move', method: null,
          attempts: 1, failures: 1,
          firstFailureAt: '2026-07-12T12:01:00.000Z', lastFailureAt: '2026-07-12T12:01:00.000Z',
          agents: ['main'], unattributedFailures: 0, systemFailures: 0, medianFailureDurationMs: 80,
          latestFailure: {
            id: 'usage-tool-failure',
            ts: '2026-07-12T12:01:00.000Z', kind: 'mcp', activityClass: 'user',
            name: 'bakin_exec_tasks_move', agent: 'main', durationMs: 80, status: 'error',
          },
        },
      ],
      failureGroupPage: { total: 2, offset: 0, limit: 25, hasMore: false },
      topByName: [],
      agentCount: 0,
      byAgent: [],
      recent: [
        {
          id: 'usage-rest-failure',
          ts: '2026-07-12T12:02:00.000Z', kind: 'rest', activityClass: 'routine',
          name: '/api/plugins/search/reindex', agent: null, durationMs: 340, status: 'error',
          meta: { statusCode: 500 },
        },
        {
          id: 'usage-tool-failure',
          ts: '2026-07-12T12:01:00.000Z', kind: 'mcp', activityClass: 'user',
          name: 'bakin_exec_tasks_move', agent: 'main', durationMs: 80, status: 'error',
        },
        {
          id: 'usage-agent-success',
          ts: '2026-07-12T12:00:00.000Z', kind: 'agent', activityClass: 'user',
          name: 'dispatch', agent: 'patch', durationMs: 1200, status: 'ok',
        },
      ],
      recentFailures: [
        {
          id: 'usage-rest-failure',
          ts: '2026-07-12T12:02:00.000Z', kind: 'rest', activityClass: 'routine',
          name: '/api/plugins/search/reindex', agent: null, durationMs: 340, status: 'error',
          meta: { statusCode: 500 },
        },
        {
          id: 'usage-tool-failure',
          ts: '2026-07-12T12:01:00.000Z', kind: 'mcp', activityClass: 'user',
          name: 'bakin_exec_tasks_move', agent: 'main', durationMs: 80, status: 'error',
        },
      ],
      recentUnverified: [],
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

function activityWithFailurePatterns(count: number): UseHealthResourceResult<UsageFeedData> {
  const base = activityData()
  const template = base.data!.failureGroups[1]!
  const templateFailure = template.latestFailure!
  const failureGroups = Array.from({ length: count }, (_, index) => {
    const position = index + 1
    const name = `failure.pattern.${position}`
    const timestamp = `2026-07-13T11:${String(55 - index).padStart(2, '0')}:00.000Z`
    return {
      ...template,
      name,
      destination: name,
      firstFailureAt: timestamp,
      lastFailureAt: timestamp,
      latestFailure: {
        ...templateFailure,
        id: `failure-pattern-${position}`,
        name,
        ts: timestamp,
      },
    }
  })
  const recentFailures = failureGroups.map((group) => group.latestFailure)
  return {
    ...base,
    data: {
      ...base.data!,
      totals: { count, errors: count, errorRate: count > 0 ? 1 : 0 },
      outcomes: { failed: count, unverified: 0, canceled: 0, succeeded: 0 },
      byKind: [
        { kind: 'mcp', total: count, failures: count },
        { kind: 'rest', total: 0, failures: 0 },
        { kind: 'agent', total: 0, failures: 0 },
      ],
      failureGroups,
      failureGroupPage: { total: count, offset: 0, limit: 25, hasMore: false },
      recent: recentFailures,
      recentFailures,
    },
  }
}

function activityDashboardData(): UseHealthResourceResult<UsageFeedData> {
  const toolFailureEarlier: UsageFeedData['recent'][number] = {
    id: 'usage-tool-failure-earlier',
    ts: '2026-07-13T11:40:00.000Z',
    kind: 'mcp', activityClass: 'user', name: 'search.query', agent: 'main', durationMs: 40, status: 'error',
    meta: { error: 'Earlier provider timeout' },
  }
  const toolFailureLatest: UsageFeedData['recent'][number] = {
    id: 'usage-tool-failure-latest',
    ts: '2026-07-13T11:50:00.000Z',
    kind: 'mcp', activityClass: 'user', name: 'search.query', agent: 'pixel', durationMs: 20, status: 'error',
    meta: { error: 'Latest provider timeout' },
  }
  const apiFailure: UsageFeedData['recent'][number] = {
    id: 'usage-api-failure',
    ts: '2026-07-13T11:55:00.000Z',
    kind: 'rest', activityClass: 'user', name: 'search.query', agent: 'scout', durationMs: 30, status: 'error',
    meta: { error: 'Search service returned 503', httpStatus: 503 },
  }
  const agentFailure: UsageFeedData['recent'][number] = {
    id: 'usage-agent-failure',
    ts: '2026-07-13T11:58:00.000Z',
    kind: 'agent', activityClass: 'user', name: 'dispatch', agent: 'patch', durationMs: 50, status: 'error',
  }
  const unverified: UsageFeedData['recent'][number] = {
    id: 'usage-tool-unverified',
    ts: '2026-07-13T11:52:00.000Z',
    kind: 'mcp', activityClass: 'user', name: 'web.search', agent: 'main', durationMs: 25, status: 'ok',
    meta: { resultMissing: true, turnTerminalStatus: 'completed' },
  }
  const canceled: UsageFeedData['recent'][number] = {
    id: 'usage-agent-canceled',
    ts: '2026-07-13T11:57:00.000Z',
    kind: 'agent', activityClass: 'user', name: 'stream', agent: 'patch', durationMs: 80, status: 'ok',
    meta: { terminalStatus: 'aborted' },
  }
  const toolSuccess: UsageFeedData['recent'][number] = {
    id: 'usage-tool-success',
    ts: '2026-07-13T11:45:00.000Z',
    kind: 'mcp', activityClass: 'user', name: 'search.query', agent: 'main', durationMs: 10, status: 'ok',
  }
  const apiSuccess: UsageFeedData['recent'][number] = {
    id: 'usage-api-success',
    ts: '2026-07-13T11:54:00.000Z',
    kind: 'rest', activityClass: 'user', name: 'search.query', agent: 'scout', durationMs: 12, status: 'ok',
  }
  const agentSuccess: UsageFeedData['recent'][number] = {
    id: 'usage-agent-success',
    ts: '2026-07-13T11:56:00.000Z',
    kind: 'agent', activityClass: 'user', name: 'dispatch', agent: 'patch', durationMs: 45, status: 'ok',
  }

  const base = activityData()
  return {
    ...base,
    data: {
      capabilities: { exactFailureTargeting: true, sourceBalancedActivity: true },
      totals: { count: 9, errors: 4, errorRate: 4 / 9 },
      topByName: [
        { kind: 'mcp', name: 'search.query', method: null, count: 3, errors: 2, medianDurationMs: 20 },
        { kind: 'agent', name: 'dispatch', method: null, count: 2, errors: 1, medianDurationMs: 48 },
        { kind: 'rest', name: 'search.query', method: null, count: 2, errors: 1, medianDurationMs: 21 },
        { kind: 'mcp', name: 'web.search', method: null, count: 1, errors: 0, medianDurationMs: 25 },
      ],
      byAgent: [
        { agent: 'main', attributed: true, count: 4, errors: 2, lastActivity: null },
        { agent: 'patch', attributed: true, count: 3, errors: 1, lastActivity: null },
        { agent: 'scout', attributed: true, count: 2, errors: 1, lastActivity: null },
      ],
      agentCount: 3,
      recent: [
        agentFailure,
        canceled,
        agentSuccess,
        apiFailure,
        apiSuccess,
        unverified,
        toolFailureLatest,
        toolSuccess,
        toolFailureEarlier,
      ],
      recentFailures: [agentFailure, apiFailure, toolFailureLatest, toolFailureEarlier],
      recentUnverified: [unverified],
      timeBuckets: [
        { start: '2026-07-13T11:30:00.000Z', count: 3, failureCount: 1, failureRate: 1 / 3 },
        { start: '2026-07-13T11:45:00.000Z', count: 6, failureCount: 3, failureRate: 1 / 2 },
      ],
      window: '1h',
      coverage: {
        startsAt: '2026-07-13T11:32:00.000Z',
        hasFullWindow: false,
        reason: 'buffer_limit',
      },
      outcomes: { failed: 4, unverified: 1, canceled: 1, succeeded: 3 },
      byKind: [
        { kind: 'mcp', total: 4, failures: 2 },
        { kind: 'rest', total: 2, failures: 1 },
        { kind: 'agent', total: 3, failures: 1 },
      ],
      failureGroups: [
        {
          kind: 'mcp', name: 'search.query', destination: 'search.query', method: null, attempts: 3, failures: 2,
          firstFailureAt: toolFailureEarlier.ts, lastFailureAt: toolFailureLatest.ts,
          agents: ['main', 'pixel'], unattributedFailures: 0, systemFailures: 0, medianFailureDurationMs: 30,
          latestFailure: toolFailureLatest,
        },
        {
          kind: 'agent', name: 'dispatch', destination: 'dispatch', method: null, attempts: 2, failures: 1,
          firstFailureAt: agentFailure.ts, lastFailureAt: agentFailure.ts,
          agents: ['patch'], unattributedFailures: 0, systemFailures: 0, medianFailureDurationMs: 50,
          latestFailure: agentFailure,
        },
        {
          kind: 'rest', name: 'search.query', destination: 'search.query', method: null, attempts: 2, failures: 1,
          firstFailureAt: apiFailure.ts, lastFailureAt: apiFailure.ts,
          agents: ['scout'], unattributedFailures: 0, systemFailures: 0, medianFailureDurationMs: 30,
          latestFailure: apiFailure,
        },
      ],
      failureGroupPage: { total: 3, offset: 0, limit: 25, hasMore: false },
    },
  }
}

const useActivityDataMock = mock((_options: unknown) => activityData())

mock.module('../../../plugins/health/hooks/use-activity-data', () => ({
  useActivityData: useActivityDataMock,
}))

import { ActivityTab } from '../../../plugins/health/components/activity-tab'

beforeEach(() => {
  queryInitialValues.clear()
  queryWrites.length = 0
  useActivityDataMock.mockClear()
  useActivityDataMock.mockImplementation((_options: unknown) => activityData())
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('ActivityTab', () => {
  it('leads with the visual pulse and keeps raw failure evidence behind disclosure', () => {
    render(<ActivityTab />)

    const tab = screen.getByTestId('health-activity-tab')
    const pulse = within(tab).getByRole('region', { name: 'Activity pulse' })
    const needsAttention = within(tab).getByRole('region', { name: 'Hiccups' })
    expect(pulse.compareDocumentPosition(needsAttention) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(tab).queryByText('Needs attention')).toBeNull()
    expect(within(tab).queryByRole('region', { name: 'Needs attention' })).toBeNull()
    expect(within(tab).queryByText('Failure rate')).toBeNull()

    expect(within(needsAttention).queryByText('Technical details')).toBeNull()
    expect(within(needsAttention).queryByRole('group', { name: 'API · Search Reindex' })).toBeNull()
    expect(within(needsAttention).queryByRole('button', { name: /failure event for API · Search Reindex/i })).toBeNull()
    fireEvent.click(within(needsAttention).getByRole('button', { name: 'Review all 2 failure patterns' }))
    const api = within(needsAttention).getByRole('group', { name: 'API · Search Reindex' })
    expect(within(api).getByText('Bakin system')).toBeDefined()
    expect(within(api).queryByText(/unattributed/i)).toBeNull()
    const expand = within(api).getByRole('button', { name: 'View 1 failure event for API · Search Reindex' })
    fireEvent.click(expand)
    expect(expand.getAttribute('aria-expanded')).toBe('true')
    expect(within(api).getByText('Technical details')).toBeDefined()
    expect(within(api).getByText('/api/plugins/search/reindex')).toBeDefined()
    expect(within(tab).getByRole('region', { name: 'Recent events' })).toBeDefined()
  })

  it('keeps older failures and result gaps inspectable after more than 50 newer successes', () => {
    const base = activityData()
    const recentSuccesses: UsageFeedData['recent'] = Array.from({ length: 50 }, (_, index) => ({
      id: `usage-new-success-${index}`,
      ts: new Date(Date.parse('2026-07-12T12:10:00.000Z') + index).toISOString(),
      kind: 'mcp',
      activityClass: 'user',
      name: `success_${index}`,
      agent: 'main',
      durationMs: 10,
      status: 'ok',
    }))
    const olderFailure: UsageFeedData['recent'][number] = {
      id: 'usage-older-failure',
      ts: '2026-07-12T12:00:00.000Z',
      kind: 'mcp',
      activityClass: 'user',
      name: 'bakin_exec_older_failure',
      agent: 'main',
      durationMs: 12,
      status: 'error',
    }
    const olderUnverified: UsageFeedData['recent'][number] = {
      id: 'usage-older-unverified',
      ts: '2026-07-12T11:59:00.000Z',
      kind: 'mcp',
      activityClass: 'routine',
      name: 'bakin_exec_older_unverified',
      agent: 'main',
      durationMs: 12,
      status: 'ok',
      meta: { resultMissing: true, turnTerminalStatus: 'completed' },
    }
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        totals: { count: 62, errors: 1, errorRate: 1 / 62 },
        outcomes: { failed: 1, unverified: 1, canceled: 0, succeeded: 60 },
        byKind: [
          { kind: 'rest', total: 0, failures: 0 },
          { kind: 'mcp', total: 62, failures: 1 },
          { kind: 'agent', total: 0, failures: 0 },
        ],
        failureGroups: [{
          kind: 'mcp', name: olderFailure.name, destination: olderFailure.name, method: null, attempts: 1, failures: 1,
          firstFailureAt: olderFailure.ts, lastFailureAt: olderFailure.ts,
          agents: ['main'], unattributedFailures: 0, systemFailures: 0, medianFailureDurationMs: 12,
          latestFailure: olderFailure,
        }],
        failureGroupPage: { total: 1, offset: 0, limit: 25, hasMore: false },
        recent: recentSuccesses,
        recentFailures: [olderFailure],
        recentUnverified: [olderUnverified],
      },
    }))

    render(<ActivityTab />)

    fireEvent.click(screen.getByRole('button', { name: 'Review all 1 failure pattern' }))
    const failure = screen.getByRole('group', { name: 'Tools · Older Failure' })
    fireEvent.click(within(failure).getByRole('button', { name: 'View 1 failure event for Tools · Older Failure' }))
    expect(within(failure).getByRole('list', { name: 'Failure events for Tools · Older Failure' })).toBeDefined()

    const recent = screen.getByRole('region', { name: 'Recent events' })
    const rows = within(recent).getAllByRole('listitem')
    expect(rows).toHaveLength(52)
    expect(rows.at(-2)?.textContent).toContain('Older Failure')
    expect(rows.at(-1)?.textContent).toContain('Older Unverified')
    expect(within(recent).getByText('Older Failure')).toBeDefined()
    expect(within(recent).getByText('Older Unverified')).toBeDefined()
  })

  it('states when the failure list is capped below the total', () => {
    const base = activityData()
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        totals: { count: 60, errors: 51, errorRate: 51 / 60 },
        outcomes: { failed: 51, unverified: 0, canceled: 0, succeeded: 9 },
        byKind: [
          { kind: 'rest', total: 1, failures: 1 },
          { kind: 'mcp', total: 58, failures: 50 },
          { kind: 'agent', total: 1, failures: 0 },
        ],
        failureGroups: [
          {
            kind: 'rest', name: '/api/plugins/search/reindex', destination: '/api/plugins/search/reindex', method: null,
            attempts: 1, failures: 1,
            firstFailureAt: '2026-07-12T12:02:00.000Z', lastFailureAt: '2026-07-12T12:02:00.000Z',
            agents: [], unattributedFailures: 0, systemFailures: 1, medianFailureDurationMs: 340,
            latestFailure: base.data!.recentFailures[0]!,
          },
          {
            kind: 'mcp', name: 'bakin_exec_tasks_move', destination: 'bakin_exec_tasks_move', method: null,
            attempts: 58, failures: 50,
            firstFailureAt: '2026-07-12T11:01:00.000Z', lastFailureAt: '2026-07-12T12:01:00.000Z',
            agents: ['main'], unattributedFailures: 0, systemFailures: 0, medianFailureDurationMs: 80,
            latestFailure: base.data!.recentFailures[1]!,
          },
        ],
      },
    }))

    render(<ActivityTab />)

    expect(screen.getByText(/showing 2 of 51 failure events/i)).toBeDefined()
  })

  it('renders a compact failure-only trend with an exact accessible table', () => {
    render(<ActivityTab />)

    const attention = screen.getByRole('region', { name: 'Hiccups' })
    const chart = within(attention).getByRole('group', { name: 'Failures over time' })
    expect(chart.getAttribute('viewBox')).toBe('0 0 640 120')
    expect(chart.closest('[data-activity-failure-trend-plot]')?.className).toContain('max-w-4xl')

    const table = within(attention).getByRole('table', { name: 'Failures over time data' })
    expect(within(table).getByText('Failures')).toBeDefined()
    expect(within(table).queryByText('All activity')).toBeNull()
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(attention.contains(chart)).toBe(true)
    expect(within(attention).getByRole('note').textContent).toContain('latest interval')
  })

  it('omits unknown pre-coverage intervals from the failure trend and its exact table', () => {
    const base = activityData()
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        coverage: {
          startsAt: '2026-07-12T12:02:00.000Z',
          hasFullWindow: false,
          reason: 'process_restart',
        },
        timeBuckets: [
          { start: '2026-07-12T11:55:00.000Z', count: 0, failureCount: 0, failureRate: 0 },
          { start: '2026-07-12T12:00:00.000Z', count: 1, failureCount: 0, failureRate: 0 },
          { start: '2026-07-12T12:05:00.000Z', count: 2, failureCount: 2, failureRate: 1 },
        ],
      },
    }))

    render(<ActivityTab />)

    const hiccups = screen.getByRole('region', { name: 'Hiccups' })
    const table = within(hiccups).getByRole('table', { name: 'Failures over time data' })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(table).queryByText('11:55 AM')).toBeNull()
    expect(within(hiccups).getByText(
      /Partial history since 12:02 PM; intervals entirely before that are omitted\./,
    )).toBeDefined()
  })

  it('keeps a lone partial-history bucket when its interval width is unknown', () => {
    const base = activityData()
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        coverage: {
          startsAt: '2026-07-12T12:02:00.000Z',
          hasFullWindow: false,
          reason: 'process_restart',
        },
        timeBuckets: [
          { start: '2026-07-12T12:00:00.000Z', count: 1, failureCount: 1, failureRate: 1 },
        ],
      },
    }))

    render(<ActivityTab />)

    const table = within(screen.getByRole('region', { name: 'Hiccups' }))
      .getByRole('table', { name: 'Failures over time data' })
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).getByText('12:00 PM')).toBeDefined()
  })

  it('does not offer an empty failure-pattern disclosure while grouped evidence refreshes', () => {
    const base = activityData()
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        failureGroups: [],
        failureGroupPage: { total: 0, offset: 0, limit: 25, hasMore: false },
      },
    }))

    render(<ActivityTab />)

    const attention = screen.getByRole('region', { name: 'Hiccups' })
    expect(within(attention).getByText('Refreshing failure patterns…')).toBeDefined()
    expect(within(attention).queryByRole('button', { name: /Review .*failure pattern/i })).toBeNull()
    expect(within(attention).getByRole('group', { name: 'Failures over time' })).toBeDefined()
  })

  it('uses a calm zero-failure summary without empty chart or success sections', () => {
    const base = activityData()
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        totals: { count: 690, errors: 0, errorRate: 0 },
        outcomes: { failed: 0, unverified: 0, canceled: 0, succeeded: 690 },
        byKind: [
          { kind: 'rest', total: 0, failures: 0 },
          { kind: 'mcp', total: 690, failures: 0 },
          { kind: 'agent', total: 0, failures: 0 },
        ],
        failureGroups: [],
        recent: [],
        recentFailures: [],
        recentUnverified: [],
        timeBuckets: [
          { start: '2026-07-12T12:00:00.000Z', count: 345, failureCount: 0, failureRate: 0 },
          { start: '2026-07-12T12:05:00.000Z', count: 345, failureCount: 0, failureRate: 0 },
        ],
      },
    }))

    render(<ActivityTab />)

    const metrics = screen.getByRole('group', { name: 'Activity metrics' })
    expect(within(metrics).getByText('690')).toBeDefined()
    expect(within(metrics).getByText('100%')).toBeDefined()
    const pulse = screen.getByRole('region', { name: 'Activity pulse' })
    expect(within(pulse).getByRole('group', {
      name: 'Activity outcomes: 0 failed, 0 unverified, 0 canceled, 690 succeeded',
    })).toBeDefined()
    expect(within(pulse).getByText('No failures')).toBeDefined()
    expect(within(pulse).queryByRole('link', { name: 'No failures' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Hiccups' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Failures over time' })).toBeNull()
    expect(screen.queryByText(/Successful activity \(/)).toBeNull()
    expect(screen.getByRole('region', { name: 'Activity over time' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Call breakdown' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Recent events' })).toBeDefined()
  })

  it('keeps an unobserved result in the Hiccups view without calling it healthy', () => {
    const base = activityData()
    const unverifiedEntry: UsageFeedData['recent'][number] = {
      id: 'usage-tool-needs-verification',
      ts: '2026-07-12T12:03:00.000Z',
      kind: 'mcp',
      activityClass: 'user',
      name: 'web_search',
      agent: 'main',
      durationMs: 20,
      status: 'ok',
      meta: { source: 'runtime-native', resultMissing: true, turnTerminalStatus: 'completed' },
    }
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        totals: { count: 1, errors: 0, errorRate: 0 },
        outcomes: { failed: 0, unverified: 1, canceled: 0, succeeded: 0 },
        byKind: [
          { kind: 'rest', total: 0, failures: 0 },
          { kind: 'mcp', total: 1, failures: 0 },
          { kind: 'agent', total: 0, failures: 0 },
        ],
        failureGroups: [],
        recent: [unverifiedEntry],
        recentFailures: [],
        recentUnverified: [unverifiedEntry],
      },
    }))

    render(<ActivityTab />)

    const pulse = screen.getByRole('region', { name: 'Activity pulse' })
    expect(within(pulse).getByText('Verify result')).toBeDefined()
    expect(within(pulse).queryByText('No failures')).toBeNull()
    expect(within(pulse).getByRole('link', { name: 'Verify result' }).getAttribute('href')).toBe('#activity-needs-attention')
    const attention = screen.getByRole('region', { name: 'Hiccups' })
    expect(within(attention).getByRole('heading', { name: 'Results to verify' })).toBeDefined()
    expect(within(attention).getByText('Web Search')).toBeDefined()
    expect(within(attention).getByText('Result not observed')).toBeDefined()
    const metrics = screen.getByRole('group', { name: 'Activity metrics' })
    expect(within(metrics).getByText('Hiccups')).toBeDefined()
    const successTile = within(metrics).getByText('Success rate').closest('[data-stat-tile]')
    expect(successTile?.querySelector('.bg-warning')).not.toBeNull()
    expect(successTile?.querySelector('.bg-success')).toBeNull()
    expect(within(attention).queryByRole('group', { name: 'Failures over time' })).toBeNull()
    expect(within(attention).queryByRole('list', { name: 'Top failure patterns' })).toBeNull()
    expect(within(attention).queryByRole('button', { name: /Review all .*failure pattern/i })).toBeNull()
  })

  it('shows aborted agent and tool work as canceled context instead of success or failure', () => {
    const base = activityData()
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        totals: { count: 5, errors: 2, errorRate: 0.4 },
        outcomes: { failed: 2, unverified: 0, canceled: 2, succeeded: 1 },
        byKind: [
          { kind: 'rest', total: 1, failures: 1 },
          { kind: 'mcp', total: 2, failures: 1 },
          { kind: 'agent', total: 2, failures: 0 },
        ],
        recent: [
          ...base.data!.recent,
          {
            id: 'usage-agent-aborted',
            ts: '2026-07-12T12:03:00.000Z', kind: 'agent' as const, activityClass: 'user' as const,
            name: 'stream', agent: 'main', durationMs: 20, status: 'ok' as const,
            meta: { source: 'runtime-turn', terminalStatus: 'aborted' },
          },
          {
            id: 'usage-tool-aborted',
            ts: '2026-07-12T12:04:00.000Z', kind: 'mcp' as const, activityClass: 'user' as const,
            name: 'web_search', agent: 'main', durationMs: 10, status: 'ok' as const,
            meta: { source: 'runtime-native', resultMissing: true, turnTerminalStatus: 'aborted' },
          },
        ],
      },
    }))

    render(<ActivityTab />)

    const recent = screen.queryByRole('region', { name: 'Recent events' })
    expect(recent !== null).toBe(true)
    if (!recent) return
    expect(within(recent).getAllByText('Canceled')).toHaveLength(2)
    expect(within(recent).getByText(/agent work was canceled before completion/i)).toBeDefined()
    expect(within(recent).getByText(/tool call was canceled before completion/i)).toBeDefined()
    expect(within(recent).getAllByText('Succeeded')).toHaveLength(1)
    expect(within(recent).getAllByText('Failed')).toHaveLength(2)
  })

  it('keeps a completed turn with no tool result out of both success and failure', () => {
    const base = activityData()
    const unverifiedEntry: UsageFeedData['recent'][number] = {
      id: 'usage-tool-unverified',
      ts: '2026-07-12T12:03:00.000Z',
      kind: 'mcp',
      activityClass: 'user',
      name: 'web_search',
      agent: 'main',
      durationMs: 20,
      status: 'ok',
      meta: { source: 'runtime-native', resultMissing: true, turnTerminalStatus: 'completed' },
    }
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        totals: { count: 4, errors: 2, errorRate: 0.5 },
        outcomes: { failed: 2, unverified: 1, canceled: 0, succeeded: 1 },
        byKind: [
          { kind: 'rest', total: 1, failures: 1 },
          { kind: 'mcp', total: 2, failures: 1 },
          { kind: 'agent', total: 1, failures: 0 },
        ],
        recent: [
          ...base.data!.recent,
          unverifiedEntry,
        ],
        recentUnverified: [unverifiedEntry],
      },
    }))

    render(<ActivityTab />)

    const recent = screen.getByRole('region', { name: 'Recent events' })
    expect(within(recent).getAllByText('Result not observed')).toHaveLength(1)
    expect(within(recent).getByText(/did not receive this tool call’s final result event/i)).toBeDefined()
    expect(within(recent).getAllByText('Succeeded')).toHaveLength(1)
    expect(within(recent).getAllByText('Failed')).toHaveLength(2)
  })

  it('stores window and kind choices while routine successes stay included', async () => {
    const user = userEvent.setup()
    render(<ActivityTab />)

    await user.click(screen.getByRole('combobox', { name: 'Activity window' }))
    await user.click(screen.getByRole('option', { name: 'Last 24 hours' }))
    await user.click(screen.getByRole('combobox', { name: 'Activity kind' }))
    await user.click(screen.getByRole('option', { name: 'API' }))

    expect(useActivityDataMock).toHaveBeenLastCalledWith({ window: '24h', kind: 'rest', includeRoutine: true })
    expect(queryWrites).toContainEqual({ key: 'activity_window', value: '24h' })
    expect(queryWrites).toContainEqual({ key: 'activity_kind', value: 'rest' })
    expect(screen.queryByRole('checkbox', { name: 'Include routine success' })).toBeNull()
  })

  it('renders one complete activity view and always requests routine successes', () => {
    useActivityDataMock.mockImplementation(() => activityDashboardData())

    render(<ActivityTab />)

    expect(useActivityDataMock).toHaveBeenLastCalledWith({
      window: '1h',
      kind: 'all',
      includeRoutine: true,
    })
    expect(screen.queryByRole('group', { name: 'Activity view' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Include routine success' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Activity over time' })).toBeDefined()
    const attention = screen.getByRole('region', { name: 'Hiccups' })
    expect(within(attention).getByRole('group', { name: 'Failures over time' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Call breakdown' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Recent events' })).toBeDefined()
  })

  it('does not let a legacy failed-only URL hide the complete activity view', () => {
    queryInitialValues.set('activity_outcome', 'failed')
    queryInitialValues.set('include_routine', 'false')
    useActivityDataMock.mockImplementation(() => activityDashboardData())

    render(<ActivityTab />)

    expect(screen.queryByRole('group', { name: 'Activity view' })).toBeNull()
    expect(useActivityDataMock).toHaveBeenLastCalledWith({ window: '1h', kind: 'all', includeRoutine: true })
    expect(screen.getByRole('region', { name: 'Hiccups' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Recent events' })).toBeDefined()
  })

  it('scrolls and focuses the attention section after a failure deep-link finishes loading', () => {
    const loaded = activityDashboardData()
    let resource: UseHealthResourceResult<UsageFeedData> = {
      ...loaded,
      data: null,
      loading: true,
    }
    const scrollIntoView = mock(() => undefined)
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    window.location.hash = '#activity-needs-attention'
    useActivityDataMock.mockImplementation(() => resource)

    try {
      const view = render(<ActivityTab />)
      expect(scrollIntoView).not.toHaveBeenCalled()

      resource = loaded
      view.rerender(<ActivityTab />)

      const attention = screen.getByRole('region', { name: 'Hiccups' })
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(document.activeElement).toBe(attention)

      view.rerender(<ActivityTab />)
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('uses the pulse status as a jump link that scrolls and focuses Hiccups', () => {
    useActivityDataMock.mockImplementation(() => activityDashboardData())
    const scrollIntoView = mock(() => undefined)
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      render(<ActivityTab />)
      window.history.replaceState({ router: 'preserve-me' }, '', window.location.href)

      const pulse = screen.getByRole('region', { name: 'Activity pulse' })
      const jump = within(pulse).getByRole('link', { name: 'Hiccups' })
      const attention = screen.getByRole('region', { name: 'Hiccups' })
      expect(jump.getAttribute('href')).toBe('#activity-needs-attention')
      expect(jump.compareDocumentPosition(attention) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      fireEvent.click(jump)

      expect(window.location.hash).toBe('#activity-needs-attention')
      expect(window.history.state).toEqual({ router: 'preserve-me' })
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
      expect(document.activeElement).toBe(attention)
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('respects reduced motion when navigating to Hiccups', () => {
    useActivityDataMock.mockImplementation(() => activityDashboardData())
    const scrollIntoView = mock(() => undefined)
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    const originalMatchMedia = window.matchMedia
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true }),
    })

    try {
      render(<ActivityTab />)
      fireEvent.click(within(screen.getByRole('region', { name: 'Activity pulse' })).getByRole('link', {
        name: 'Hiccups',
      }))

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
    }
  })

  it('keeps the activity chart and exact values visible together', () => {
    useActivityDataMock.mockImplementation(() => activityDashboardData())

    render(<ActivityTab />)

    const volume = screen.getByRole('region', { name: 'Activity over time' })
    const table = within(volume).getByRole('table', { name: 'Activity over time data' })
    expect(Array.from(table.querySelectorAll('time')).map((time) => time.getAttribute('datetime'))).toEqual([
      '2026-07-13T11:45:00.000Z',
      '2026-07-13T11:30:00.000Z',
    ])
    expect(within(volume).queryByText('Exact values')).toBeNull()
    expect(volume.getAttribute('data-chart-layout')).toBe('split')
  })

  it('keeps time and type filters explicit without introducing a lossy view mode', () => {
    render(<ActivityTab />)

    expect(screen.queryByRole('group', { name: 'Activity view' })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Activity window' }).getAttribute('data-slot')).toBe('select-trigger')
    expect(screen.getByRole('combobox', { name: 'Activity kind' }).getAttribute('data-slot')).toBe('select-trigger')
    expect(screen.getByRole('group', { name: 'Activity metrics' })).toBeDefined()
    const attention = screen.getByRole('region', { name: 'Hiccups' })
    expect(within(attention).getByRole('group', { name: 'Failures over time' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Activity over time' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Recent events' })).toBeDefined()
    expect(screen.queryByRole('checkbox', { name: 'Include routine success' })).toBeNull()
  })

  it('uses the shared select treatment for both activity filters', () => {
    render(<ActivityTab />)

    for (const label of ['Activity window', 'Activity kind']) {
      const select = screen.getByRole('combobox', { name: label })
      expect(select.getAttribute('data-slot')).toBe('select-trigger')
      expect(select.querySelector('[data-activity-filter-chevron]')).toBeNull()
    }
  })

  it('lands on a metrics dashboard with volume and breakdown charts', () => {
    useActivityDataMock.mockImplementation(() => activityDashboardData())

    render(<ActivityTab />)

    const metrics = screen.getByRole('group', { name: 'Activity metrics' })
    expect(within(metrics).getByText('Interactions')).toBeDefined()
    expect(within(metrics).getByText('9')).toBeDefined()
    expect(within(metrics).getByText('Success rate')).toBeDefined()
    expect(within(metrics).getByText('33.3%')).toBeDefined()
    expect(within(metrics).getByText('Hiccups')).toBeDefined()
    expect(within(metrics).getByText('5')).toBeDefined()
    expect(within(metrics).getByText('Agents observed')).toBeDefined()
    expect(within(metrics).getByText('Busiest: main (4)')).toBeDefined()

    const volume = screen.getByRole('region', { name: 'Activity over time' })
    expect(within(volume).getByText(/Partial history since/)).toBeDefined()
    const volumeTable = within(volume).getByRole('table', { name: 'Activity over time data' })
    expect(within(volumeTable).getByText('Other outcomes')).toBeDefined()
    expect(within(volumeTable).getByText('Failed')).toBeDefined()
    expect(within(volumeTable).getAllByRole('row')).toHaveLength(3)
    expect(within(volume).getByRole('note').textContent).toContain('9 calls in this window')
    const interactionsTile = within(metrics).getByText('Interactions').closest('[data-stat-tile]')
    expect(interactionsTile?.textContent).toContain('Partial window · retained history')

    const breakdown = screen.getByRole('region', { name: 'Call breakdown' })
    const destinations = within(breakdown).getByRole('list', { name: 'Top destinations' })
    expect(within(destinations).getAllByRole('listitem')).toHaveLength(4)
    const toolDestination = within(destinations).getByRole('listitem', { name: 'Tools · Search Query' })
    const apiDestination = within(destinations).getByRole('listitem', { name: 'API · Search Query' })
    const agentDestination = within(destinations).getByRole('listitem', { name: 'Agents · Dispatch' })
    expect(toolDestination.getAttribute('data-source-kind')).toBe('mcp')
    expect(apiDestination.getAttribute('data-source-kind')).toBe('rest')
    expect(agentDestination.getAttribute('data-source-kind')).toBe('agent')
    expect(toolDestination.querySelector<HTMLElement>('[data-source-bar]')?.style.backgroundColor).toBe('var(--chart-1)')
    expect(apiDestination.querySelector<HTMLElement>('[data-source-bar]')?.style.backgroundColor).toBe('var(--chart-2)')
    expect(agentDestination.querySelector<HTMLElement>('[data-source-bar]')?.style.backgroundColor).toBe('var(--chart-3)')
    expect(within(toolDestination).getByRole('button', { name: 'Review 2 failed Tools Search Query calls' })).toBeDefined()
    expect(within(apiDestination).getByRole('button', { name: 'Review 1 failed API Search Query call' })).toBeDefined()
    const agents = within(breakdown).getByRole('list', { name: 'Busiest agents' })
    expect(within(agents).getAllByRole('listitem')).toHaveLength(3)
    expect(within(agents).getByText('main')).toBeDefined()

    expect(within(metrics).queryByRole('button', { name: /Hiccups/ })).toBeNull()
    expect(screen.getByRole('region', { name: 'Hiccups' })).toBeDefined()
  })

  it('uses the exact agentCount metric when the byAgent projection is bounded', () => {
    const resource = activityDashboardData()
    useActivityDataMock.mockImplementation(() => ({
      ...resource,
      data: {
        ...resource.data!,
        totals: { count: 60, errors: 4, errorRate: 4 / 60 },
        outcomes: { failed: 4, unverified: 1, canceled: 1, succeeded: 54 },
        byKind: [
          { kind: 'mcp', total: 20, failures: 2 },
          { kind: 'rest', total: 20, failures: 1 },
          { kind: 'agent', total: 20, failures: 1 },
        ],
        agentCount: 37,
        byAgent: Array.from({ length: 10 }, (_, index) => ({
          agent: `agent-${index + 1}`,
          attributed: true,
          count: 2,
          errors: 0,
          lastActivity: null,
        })),
        timeBuckets: [
          { start: '2026-07-13T11:30:00.000Z', count: 30, failureCount: 1, failureRate: 1 / 30 },
          { start: '2026-07-13T11:45:00.000Z', count: 30, failureCount: 3, failureRate: 1 / 10 },
        ],
      } as UsageFeedData,
    }))

    render(<ActivityTab />)

    const metrics = screen.getByRole('group', { name: 'Activity metrics' })
    const agents = within(metrics).getByText('Agents observed').closest('[data-stat-tile]')
    expect(agents?.textContent).toContain('37')
  })

  it('keeps an agent literally named "unknown" visible while excluding unattributed activity', () => {
    const resource = activityDashboardData()
    useActivityDataMock.mockImplementation(() => ({
      ...resource,
      data: {
        ...resource.data!,
        agentCount: 1,
        byAgent: [
          { agent: 'unknown', attributed: true, count: 2, errors: 0, lastActivity: null },
          { agent: 'unknown', attributed: false, count: 7, errors: 0, lastActivity: null },
        ],
      } as UsageFeedData,
    }))

    render(<ActivityTab />)

    const metrics = screen.getByRole('group', { name: 'Activity metrics' })
    const agents = within(metrics).getByText('Agents observed').closest('[data-stat-tile]')
    expect(agents?.textContent).toContain('1')
    expect(agents?.textContent).toContain('Busiest: unknown (2)')

    const busiestAgents = within(screen.getByTestId('activity-breakdown'))
      .getByRole('list', { name: 'Busiest agents' })
    expect(within(busiestAgents).getAllByRole('listitem')).toHaveLength(1)
    expect(within(busiestAgents).getByText('unknown')).toBeDefined()
  })

  it('falls back to attributed byAgent rows when an older payload omits agentCount', () => {
    const resource = activityDashboardData()
    const { agentCount: _agentCount, ...legacyData } = resource.data!
    useActivityDataMock.mockImplementation(() => ({ ...resource, data: legacyData }))

    render(<ActivityTab />)

    const metrics = screen.getByRole('group', { name: 'Activity metrics' })
    const agents = within(metrics).getByText('Agents observed').closest('[data-stat-tile]')
    expect(agents?.textContent).toContain('3')
    expect(agents?.textContent).toContain('Busiest: main (4)')
  })

  it('shows all ten bounded destinations during a rolling contract refresh', () => {
    const resource = activityDashboardData()
    const routineApiRows: UsageFeedData['topByName'] = Array.from({ length: 8 }, (_, index) => ({
      kind: 'rest',
      method: 'GET',
      name: `/api/plugins/health/poll-${index}`,
      count: 20 - index,
      errors: 0,
      medianDurationMs: 2,
    }))
    useActivityDataMock.mockImplementation(() => ({
      ...resource,
      data: {
        ...resource.data!,
        capabilities: { exactFailureTargeting: true },
        topByName: [
          ...routineApiRows,
          {
            kind: 'mcp', method: null, name: 'bakin_exec_images_generate',
            count: 1, errors: 0, medianDurationMs: 25_749,
          },
          {
            kind: 'mcp', method: null, name: 'bash',
            count: 1, errors: 0, medianDurationMs: 13,
          },
        ],
      },
    }))

    render(<ActivityTab />)

    const destinations = screen.getByRole('list', { name: 'Top destinations' })
    expect(within(destinations).getAllByRole('listitem')).toHaveLength(10)
    expect(within(destinations).getByRole('listitem', { name: 'Tools · Images Generate' })).toBeDefined()
    expect(within(destinations).getByRole('listitem', { name: 'Tools · Bash' })).toBeDefined()
  })

  it('opens, highlights, and smoothly focuses the exact failure pattern from a destination count', () => {
    useActivityDataMock.mockImplementation(() => activityDashboardData())
    const scrollIntoView = mock(() => undefined)
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      render(<ActivityTab />)

      const destinations = screen.getByRole('list', { name: 'Top destinations' })
      const toolDestination = within(destinations).getByRole('listitem', { name: 'Tools · Search Query' })
      fireEvent.click(within(toolDestination).getByRole('button', {
        name: 'Review 2 failed Tools Search Query calls',
      }))

      const attention = screen.getByRole('region', { name: 'Hiccups' })
      expect(within(attention).getByRole('button', { name: 'Hide failure details' }).getAttribute('aria-expanded')).toBe('true')
      const toolGroup = within(attention).getByRole('group', { name: 'Tools · Search Query' })
      const apiGroup = within(attention).getByRole('group', { name: 'API · Search Query' })
      expect(toolGroup.getAttribute('data-selected')).toBe('true')
      expect(apiGroup.getAttribute('data-selected')).toBeNull()
      expect(document.activeElement).toBe(toolGroup)
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
      expect(window.location.hash).toBe('#activity-needs-attention')
      expect(within(toolGroup).getByRole('button', {
        name: 'View 2 failure events for Tools · Search Query',
      }).getAttribute('aria-expanded')).toBe('false')
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('targets the exact REST method when two failed methods share one route', () => {
    const base = activityData()
    const getFailure: UsageFeedData['recent'][number] = {
      id: 'usage-search-route-get',
      ts: '2026-07-13T11:50:00.000Z',
      kind: 'rest',
      activityClass: 'user',
      name: 'search.route',
      agent: 'main',
      durationMs: 20,
      status: 'error',
      meta: { method: 'GET', routePattern: 'search.route', httpStatus: 500 },
    }
    const postFailure: UsageFeedData['recent'][number] = {
      ...getFailure,
      id: 'usage-search-route-post',
      ts: '2026-07-13T11:51:00.000Z',
      meta: { method: 'POST', routePattern: 'search.route', httpStatus: 500 },
    }
    const groups: UsageFeedData['failureGroups'] = [
      {
        kind: 'rest', name: 'search.route', destination: 'search.route', method: 'GET',
        attempts: 1, failures: 1, firstFailureAt: getFailure.ts, lastFailureAt: getFailure.ts,
        agents: ['main'], unattributedFailures: 0, systemFailures: 0, medianFailureDurationMs: 20,
        latestFailure: getFailure,
      },
      {
        kind: 'rest', name: 'search.route', destination: 'search.route', method: 'POST',
        attempts: 1, failures: 1, firstFailureAt: postFailure.ts, lastFailureAt: postFailure.ts,
        agents: ['main'], unattributedFailures: 0, systemFailures: 0, medianFailureDurationMs: 20,
        latestFailure: postFailure,
      },
    ]
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        capabilities: { exactFailureTargeting: true, sourceBalancedActivity: true },
        totals: { count: 2, errors: 2, errorRate: 1 },
        outcomes: { failed: 2, unverified: 0, canceled: 0, succeeded: 0 },
        byKind: [
          { kind: 'mcp', total: 0, failures: 0 },
          { kind: 'rest', total: 2, failures: 2 },
          { kind: 'agent', total: 0, failures: 0 },
        ],
        topByName: [
          { kind: 'rest', method: 'GET', name: 'search.route', count: 1, errors: 1, medianDurationMs: 20 },
          { kind: 'rest', method: 'POST', name: 'search.route', count: 1, errors: 1, medianDurationMs: 20 },
        ],
        failureGroups: groups,
        failureGroupPage: { total: 2, offset: 0, limit: 25, hasMore: false },
        recent: [postFailure, getFailure],
        recentFailures: [postFailure, getFailure],
        recentUnverified: [],
      },
    }))
    const scrollIntoView = mock(() => undefined)
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      render(<ActivityTab />)

      fireEvent.click(screen.getByRole('button', {
        name: 'Review 1 failed API GET Search Route call',
      }))

      expect(useActivityDataMock).toHaveBeenLastCalledWith(expect.objectContaining({
        exactFailureTargetingSupported: true,
        failureGroupTarget: { kind: 'rest', method: 'GET', destination: 'search.route' },
      }))
      const getGroup = screen.getByRole('group', { name: 'API · GET Search Route' })
      const postGroup = screen.getByRole('group', { name: 'API · POST Search Route' })
      expect(getGroup.getAttribute('data-selected')).toBe('true')
      expect(postGroup.getAttribute('data-selected')).toBeNull()
      expect(document.activeElement).toBe(getGroup)
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('does not reopen an old failure selection after switching filters away and back', async () => {
    const user = userEvent.setup()
    useActivityDataMock.mockImplementation(() => activityDashboardData())
    const scrollIntoView = mock(() => undefined)
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      render(<ActivityTab />)

      fireEvent.click(screen.getByRole('button', {
        name: 'Review 2 failed Tools Search Query calls',
      }))
      expect(screen.getByRole('button', { name: 'Hide failure details' })).toBeDefined()
      expect(scrollIntoView).toHaveBeenCalledTimes(1)

      await user.click(screen.getByRole('combobox', { name: 'Activity kind' }))
      await user.click(screen.getByRole('option', { name: 'Tools' }))
      await user.click(screen.getByRole('combobox', { name: 'Activity kind' }))
      await user.click(screen.getByRole('option', { name: 'All types' }))

      expect(screen.queryByRole('button', { name: 'Hide failure details' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Review all 3 failure patterns' })).toBeDefined()
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('restores disclosure focus after a page-one exact target closes across a loading gap', async () => {
    const loaded = activityDashboardData()
    let resource = loaded
    useActivityDataMock.mockImplementation(() => resource)
    const scrollIntoView = mock(() => undefined)
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      const view = render(<ActivityTab />)

      fireEvent.click(screen.getByRole('button', {
        name: /Review 2 failed (?:MCP|Tools) Search Query calls/,
      }))
      const selected = screen.getByRole('group', { name: 'Tools · Search Query' })
      expect(selected.getAttribute('data-selected')).toBe('true')
      expect(document.activeElement).toBe(selected)
      expect(useActivityDataMock).toHaveBeenLastCalledWith(expect.objectContaining({
        failureGroupTarget: { kind: 'mcp', method: null, destination: 'search.query' },
      }))

      fireEvent.click(screen.getByRole('button', { name: 'Hide failure details' }))
      expect(useActivityDataMock).toHaveBeenLastCalledWith({ window: '1h', kind: 'all', includeRoutine: true })

      resource = { ...loaded, data: null, loading: true }
      view.rerender(<ActivityTab />)
      expect(screen.getByRole('status', { name: 'Loading activity' })).toBeDefined()

      resource = loaded
      view.rerender(<ActivityTab />)

      const review = screen.getByRole('button', { name: 'Review all 3 failure patterns' })
      expect(review.getAttribute('aria-expanded')).toBe('false')
      await waitFor(() => {
        expect(document.activeElement?.id).toBe('activity-failure-pattern-disclosure')
      })

      fireEvent.click(review)
      const reopened = screen.getByRole('group', { name: 'Tools · Search Query' })
      expect(reopened.getAttribute('data-selected')).toBeNull()
      expect(document.activeElement).not.toBe(reopened)
      expect(scrollIntoView).toHaveBeenCalledTimes(2)
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('asks the server for the exact failure page before focusing a destination outside the first 25 patterns', () => {
    const resource = activityWithFailurePatterns(30)
    const allGroups = resource.data!.failureGroups
    useActivityDataMock.mockImplementation((options: unknown) => {
      const request = options as { failureGroupTarget?: { destination: string } }
      const offset = request.failureGroupTarget?.destination === 'failure.pattern.28' ? 25 : 0
      return {
        ...resource,
        data: {
          ...resource.data!,
          topByName: [{
            kind: 'mcp',
            name: 'failure.pattern.28',
            method: null,
            count: 1,
            errors: 1,
            medianDurationMs: 20,
          }],
          failureGroups: allGroups.slice(offset, offset + 25),
          failureGroupPage: {
            total: 30,
            offset,
            limit: 25,
            hasMore: offset + 25 < 30,
          },
        },
      }
    })
    const scrollIntoView = mock(() => undefined)
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      render(<ActivityTab />)

      fireEvent.click(screen.getByRole('button', {
        name: 'Review 1 failed Tools Failure Pattern 28 call',
      }))

      expect(useActivityDataMock).toHaveBeenLastCalledWith(expect.objectContaining({
        window: '1h',
        kind: 'all',
        includeRoutine: true,
        exactFailureTargetingSupported: true,
        failureGroupTarget: {
          kind: 'mcp',
          method: null,
          destination: 'failure.pattern.28',
        },
      }))
      const group = screen.getByRole('group', { name: 'Tools · Failure Pattern 28' })
      expect(group.getAttribute('data-selected')).toBe('true')
      expect(document.activeElement).toBe(group)
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('keeps legacy source-less destinations neutral and links them to general failure details', () => {
    const resource = activityData()
    useActivityDataMock.mockImplementation(() => ({
      ...resource,
      data: {
        ...resource.data!,
        topByName: [{
          name: '/api/plugins/search/reindex',
          count: 1,
          errors: 1,
          medianDurationMs: 340,
        }],
      },
    }))
    const scrollIntoView = mock(() => undefined)
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      render(<ActivityTab />)

      const destination = screen.getByRole('listitem', { name: 'Search Reindex' })
      expect(destination.getAttribute('data-source-kind')).toBe('unknown')
      expect(destination.querySelector<HTMLElement>('[data-source-bar]')?.style.backgroundColor).toBe('var(--muted-foreground)')
      fireEvent.click(within(destination).getByRole('button', {
        name: 'Review 1 failed Search Reindex call',
      }))

      const attention = screen.getByRole('region', { name: 'Hiccups' })
      expect(within(attention).getByRole('button', { name: 'Hide failure details' }).getAttribute('aria-expanded')).toBe('true')
      expect(document.activeElement).toBe(attention)
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('keeps one compact chronological feed beside the incident details', () => {
    useActivityDataMock.mockImplementation(() => activityDashboardData())

    render(<ActivityTab />)

    expect(screen.queryByRole('button', { name: 'All events' })).toBeNull()
    const attention = screen.getByRole('region', { name: 'Hiccups' })
    expect(within(attention).getByRole('group', { name: 'Failures over time' })).toBeDefined()

    const recent = screen.getByRole('region', { name: 'Recent events' })
    const eventList = within(recent).getByRole('list', { name: 'Recent events' })
    expect(within(eventList).getAllByRole('listitem')).toHaveLength(9)
    expect(within(eventList).getAllByText('Failed')).toHaveLength(4)
    expect(within(eventList).getAllByText('Succeeded')).toHaveLength(3)
    expect(within(eventList).getAllByText('Canceled')).toHaveLength(1)
    expect(within(eventList).getAllByText('Result not observed')).toHaveLength(1)
    expect(within(eventList).getByRole('button', {
      name: /View Dispatch details — Failed, Agents, Agent patch,/,
    })).toBeDefined()
    expect(Array.from(eventList.querySelectorAll('time')).map((time) => time.getAttribute('datetime'))).toEqual([
      '2026-07-13T11:58:00.000Z',
      '2026-07-13T11:57:00.000Z',
      '2026-07-13T11:56:00.000Z',
      '2026-07-13T11:55:00.000Z',
      '2026-07-13T11:54:00.000Z',
      '2026-07-13T11:52:00.000Z',
      '2026-07-13T11:50:00.000Z',
      '2026-07-13T11:45:00.000Z',
      '2026-07-13T11:40:00.000Z',
    ])
    expect(screen.queryByRole('checkbox', { name: 'Include routine success' })).toBeNull()
  })

  it('distinguishes intentional Bakin work from genuinely missing agent attribution', () => {
    const base = activityData()
    const systemEntry: UsageFeedData['recent'][number] = {
      id: 'usage-system-work', ts: '2026-07-13T12:00:00.000Z', kind: 'rest', activityClass: 'system',
      name: 'search.drain', agent: null, durationMs: 10, status: 'ok',
    }
    const unattributedEntry: UsageFeedData['recent'][number] = {
      id: 'usage-unattributed-work', ts: '2026-07-13T11:59:00.000Z', kind: 'rest', activityClass: 'user',
      name: 'search.query', agent: null, durationMs: 10, status: 'ok',
    }
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        totals: { count: 2, errors: 0, errorRate: 0 },
        outcomes: { failed: 0, unverified: 0, canceled: 0, succeeded: 2 },
        byKind: [
          { kind: 'rest', total: 2, failures: 0 },
          { kind: 'mcp', total: 0, failures: 0 },
          { kind: 'agent', total: 0, failures: 0 },
        ],
        failureGroups: [],
        byAgent: [
          { agent: 'unknown', count: 1, errors: 0, lastActivity: systemEntry },
          { agent: 'main', count: 1, errors: 0, lastActivity: unattributedEntry },
        ],
        recent: [systemEntry, unattributedEntry],
        recentFailures: [],
        recentUnverified: [],
      },
    }))

    render(<ActivityTab />)

    const recent = screen.getByRole('region', { name: 'Recent events' })
    expect(within(recent).getByRole('button', {
      name: /View Search Drain details — Succeeded, API, Bakin system,/,
    })).toBeDefined()
    expect(within(recent).getByRole('button', {
      name: /View Search Query details — Succeeded, API, Agent not recorded,/,
    })).toBeDefined()
    const metrics = screen.getByRole('group', { name: 'Activity metrics' })
    const agentsTile = within(metrics).getByText('Agents observed').closest('[data-stat-tile]')
    expect(agentsTile?.textContent).toContain('1')
    expect(agentsTile?.textContent).toContain('Busiest: main (1)')
    expect(agentsTile?.textContent).not.toContain('unknown')
    const busiestAgents = screen.getByRole('list', { name: 'Busiest agents' })
    expect(within(busiestAgents).getAllByRole('listitem')).toHaveLength(1)
    expect(within(busiestAgents).queryByText('unknown')).toBeNull()
  })

  it('keeps Activity usable during a rolling client/server contract refresh', () => {
    const base = activityData()
    const {
      window: _window,
      coverage: _coverage,
      outcomes: _outcomes,
      byKind: _byKind,
      failureGroups: _failureGroups,
      ...legacyData
    } = base.data!
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: legacyData as unknown as UsageFeedData,
    }))

    render(<ActivityTab />)

    const metrics = screen.getByRole('group', { name: 'Activity metrics' })
    expect(within(metrics).getByText('3')).toBeDefined()
    expect(within(metrics).getByText('2')).toBeDefined()
    const pulse = screen.getByRole('region', { name: 'Activity pulse' })
    expect(within(pulse).getByText(/partial data.*restart Bakin/i)).toBeDefined()
    expect(within(pulse).queryByRole('group', { name: /Activity outcomes/i })).toBeNull()
    expect(within(pulse).getByRole('group', {
      name: 'Reported interaction outcomes: 2 failed, 1 other reported',
    })).toBeDefined()
    expect(within(pulse).getByText(/Recent breakdown covers 3 events/i)).toBeDefined()
    expect(screen.getByRole('region', { name: 'Hiccups' })).toBeDefined()
  })

  it('keeps Activity usable when a rolling payload includes a malformed agent row', () => {
    const base = activityData()
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        byAgent: [
          null,
          { agent: 'main', count: 1, errors: 0, lastActivity: null },
        ] as unknown as UsageFeedData['byAgent'],
      },
    }))

    expect(() => render(<ActivityTab />)).not.toThrow()

    const metrics = screen.getByRole('group', { name: 'Activity metrics' })
    const agents = within(metrics).getByText('Agents observed').closest('[data-stat-tile]')
    expect(agents?.textContent).toContain('1')
    expect(agents?.textContent).toContain('Busiest: main (1)')
  })

  it('marks a mixed-version failure group as partial until v2 evidence is complete', () => {
    const base = activityData()
    const {
      destination: _destination,
      method: _method,
      latestFailure: _latestFailure,
      systemFailures: _systemFailures,
      ...legacyGroup
    } = base.data!.failureGroups[0]!
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        failureGroups: [legacyGroup],
      } as unknown as UsageFeedData,
    }))

    render(<ActivityTab />)

    expect(screen.getAllByText(/Partial data.*restart Bakin/i)).toHaveLength(2)
    expect(screen.getByRole('region', { name: 'Hiccups' })).toBeDefined()
  })

  it('falls back safely when a rolling payload has only part of the outcome contract', () => {
    const base = activityData()
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        outcomes: { failed: 2 },
      } as unknown as UsageFeedData,
    }))

    render(<ActivityTab />)

    const pulse = screen.getByRole('region', { name: 'Activity pulse' })
    expect(within(pulse).getByText(/partial data.*restart Bakin/i)).toBeDefined()
    expect(screen.getByRole('region', { name: 'Hiccups' })).toBeDefined()
  })

  it('falls back safely when a rolling payload is structurally complete but inconsistent', () => {
    const base = activityData()
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        outcomes: { failed: 1, unverified: 0, canceled: 0, succeeded: 2 },
        failureGroupPage: { total: 2, offset: 0, limit: 0, hasMore: false },
      } as unknown as UsageFeedData,
    }))

    render(<ActivityTab />)

    expect(screen.getAllByText(/Partial data.*restart Bakin/i)).toHaveLength(2)
    expect(screen.getByRole('region', { name: 'Hiccups' })).toBeDefined()
  })

  it('keeps legacy REST failures separated by method with inspectable evidence', () => {
    const base = activityData()
    const getFailure: UsageFeedData['recent'][number] = {
      id: 'legacy-get-failure',
      ts: '2026-07-13T11:59:00.000Z',
      kind: 'rest', activityClass: 'user', name: '/mcp', agent: 'main', durationMs: 2, status: 'error',
      meta: { method: 'GET', httpStatus: 404 },
    }
    const deleteFailure: UsageFeedData['recent'][number] = {
      id: 'legacy-delete-failure',
      ts: '2026-07-13T11:58:00.000Z',
      kind: 'rest', activityClass: 'user', name: '/mcp', agent: 'main', durationMs: 3, status: 'error',
      meta: { method: 'DELETE', httpStatus: 404 },
    }
    const {
      window: _window,
      coverage: _coverage,
      outcomes: _outcomes,
      byKind: _byKind,
      failureGroups: _failureGroups,
      ...legacyData
    } = base.data!
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...legacyData,
        totals: { count: 2, errors: 2, errorRate: 1 },
        recent: [getFailure, deleteFailure],
        recentFailures: [getFailure, deleteFailure],
      } as unknown as UsageFeedData,
    }))

    render(<ActivityTab />)

    fireEvent.click(screen.getByRole('button', { name: 'Review all 2 failure patterns' }))
    const getGroup = screen.getByRole('group', { name: 'API · GET MCP Endpoint' })
    expect(within(getGroup).getByText('Endpoint not found (HTTP 404).')).toBeDefined()
    expect(within(getGroup).getByRole('button', { name: 'View 1 failure event for API · GET MCP Endpoint' })).toBeDefined()
    const deleteGroup = screen.getByRole('group', { name: 'API · DELETE MCP Endpoint' })
    expect(within(deleteGroup).getByText('Endpoint not found (HTTP 404).')).toBeDefined()
    expect(within(deleteGroup).getByRole('button', { name: 'View 1 failure event for API · DELETE MCP Endpoint' })).toBeDefined()
  })

  it('puts an exact, coverage-aware visual pulse before detailed failures', () => {
    useActivityDataMock.mockImplementation(() => activityDashboardData())

    render(<ActivityTab />)

    const pulse = screen.getByRole('region', { name: 'Activity pulse' })
    expect(within(pulse).getByRole('group', {
      name: 'Activity outcomes: 4 failed, 1 unverified, 1 canceled, 3 succeeded',
    })).toBeDefined()
    expect(within(pulse).getByText('4 failed')).toBeDefined()
    expect(within(pulse).getByText('1 unverified')).toBeDefined()
    expect(within(pulse).getByText('1 canceled')).toBeDefined()
    expect(within(pulse).getByText('3 succeeded')).toBeDefined()
    expect(pulse.textContent).toMatch(/partial window.*buffer limit/i)
    expect(pulse.querySelector('time[datetime="2026-07-13T11:32:00.000Z"]')).not.toBeNull()

    const mix = within(pulse).getByRole('group', {
      name: 'Activity mix: Tools 4, API 2, Agents 3',
    })
    expect(mix.textContent).toMatch(/Tools.*4.*API.*2.*Agents.*3/i)
    expect(mix.querySelector('[data-source-kind="mcp"] [data-source-bar]')?.className).toContain('bg-chart-1')
    expect(mix.querySelector('[data-source-kind="rest"] [data-source-bar]')?.className).toContain('bg-chart-2')
    expect(mix.querySelector('[data-source-kind="agent"] [data-source-bar]')?.className).toContain('bg-chart-3')
    expect(mix.querySelector('[data-source-kind="mcp"] .bg-destructive')).not.toBeNull()

    const jump = within(pulse).getByRole('link', { name: 'Hiccups' })
    const needsAttention = screen.getByRole('region', { name: 'Hiccups' })
    expect(jump.getAttribute('href')).toBe('#activity-needs-attention')
    expect(pulse.compareDocumentPosition(needsAttention) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'All events' })).toBeNull()
  })

  it('groups Hiccups by kind and destination with recurrence, recency, agents, and latest reason', () => {
    useActivityDataMock.mockImplementation(() => activityDashboardData())

    render(<ActivityTab />)

    const needsAttention = screen.getByRole('region', { name: 'Hiccups' })
    const highlights = within(needsAttention).getByRole('list', { name: 'Top failure patterns' })
    expect(within(highlights).getAllByRole('listitem')).toHaveLength(3)
    expect(within(highlights).getByText('2 failures in 3 attempts')).toBeDefined()
    expect(within(highlights).getByText('Latest provider timeout')).toBeDefined()
    expect(within(needsAttention).queryByRole('group', { name: 'Tools · Search Query' })).toBeNull()

    fireEvent.click(within(needsAttention).getByRole('button', { name: 'Review all 3 failure patterns' }))
    const tools = within(needsAttention).getByRole('group', { name: 'Tools · Search Query' })
    expect(within(tools).getByText('2 failures in 3 attempts')).toBeDefined()
    expect(within(tools).getByText('main, pixel')).toBeDefined()
    expect(within(tools).getByText('Latest provider timeout')).toBeDefined()
    expect(tools.querySelector('time[datetime="2026-07-13T11:50:00.000Z"]')).not.toBeNull()

    const api = within(needsAttention).getByRole('group', { name: 'API · Search Query' })
    expect(within(api).getByText('1 failure in 2 attempts')).toBeDefined()
    expect(within(api).getByText('scout')).toBeDefined()
    expect(within(api).getByText('Search service returned 503')).toBeDefined()

    const agents = within(needsAttention).getByRole('group', { name: 'Agents · Dispatch' })
    expect(within(agents).getByText('1 failure in 2 attempts')).toBeDefined()
    expect(within(agents).getByText('patch')).toBeDefined()
    expect(within(agents).getByText('No failure reason was reported.')).toBeDefined()
    expect(within(needsAttention).queryByRole('button', { name: /more failure patterns/i })).toBeNull()
  })

  it('combines the failure trend and three highest-priority compact highlights in one attention region', () => {
    useActivityDataMock.mockImplementation(() => activityWithFailurePatterns(5))

    render(<ActivityTab />)

    const attention = screen.getByRole('region', { name: 'Hiccups' })
    expect(screen.getAllByRole('region', { name: 'Hiccups' })).toHaveLength(1)
    expect(within(attention).getByRole('group', { name: 'Failures over time' })).toBeDefined()

    const highlights = within(attention).getByRole('list', { name: 'Top failure patterns' })
    expect(within(highlights).getAllByRole('listitem')).toHaveLength(3)
    expect(within(highlights).getByText('Failure Pattern 1')).toBeDefined()
    expect(within(highlights).getByText('Failure Pattern 2')).toBeDefined()
    expect(within(highlights).getByText('Failure Pattern 3')).toBeDefined()
    expect(within(highlights).queryByText('Failure Pattern 4')).toBeNull()

    expect(within(attention).queryByRole('group', { name: 'Tools · Failure Pattern 1' })).toBeNull()
    expect(within(attention).queryByRole('button', { name: /failure event.*Failure Pattern 1/i })).toBeNull()
    const review = within(attention).getByRole('button', { name: 'Review all 5 failure patterns' })
    expect(review.getAttribute('aria-expanded')).toBe('false')
    expect(review.getAttribute('aria-controls')).toBe('activity-failure-pattern-details')
  })

  it('reveals every full failure card and its per-event disclosure only on request', () => {
    useActivityDataMock.mockImplementation(() => activityWithFailurePatterns(5))

    render(<ActivityTab />)

    const attention = screen.getByRole('region', { name: 'Hiccups' })
    const review = within(attention).getByRole('button', { name: 'Review all 5 failure patterns' })
    fireEvent.click(review)

    expect(review.getAttribute('aria-expanded')).toBe('true')
    expect(attention.querySelector('#activity-failure-pattern-details')).not.toBeNull()
    const detail = within(attention).getByRole('group', { name: 'Tools · Failure Pattern 1' })
    expect(within(detail).getByRole('button', { name: 'View 1 failure event for Tools · Failure Pattern 1' })).toBeDefined()
    expect(within(attention).getByRole('group', { name: 'Tools · Failure Pattern 5' })).toBeDefined()

    fireEvent.click(review)
    expect(review.getAttribute('aria-expanded')).toBe('false')
    expect(within(attention).queryByRole('group', { name: 'Tools · Failure Pattern 1' })).toBeNull()
    expect(within(attention).getByRole('list', { name: 'Top failure patterns' })).toBeDefined()
  })

  it('keeps details open while paging, then resets the page when collapsed or filtered', async () => {
    const user = userEvent.setup()
    useActivityDataMock.mockImplementation((options: unknown) => {
      const resource = activityWithFailurePatterns(5)
      const offset = (options as { failureGroupOffset?: number }).failureGroupOffset ?? 0
      return {
        ...resource,
        data: {
          ...resource.data!,
          failureGroupPage: {
            total: 30,
            offset,
            limit: 25,
            hasMore: offset === 0,
          },
        },
      }
    })

    render(<ActivityTab />)

    const review = screen.getByRole('button', { name: 'Review failure patterns 1–5 of 30' })
    fireEvent.click(review)
    expect(screen.getByRole('group', { name: 'Tools · Failure Pattern 5' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Next failure patterns' }))
    expect(useActivityDataMock).toHaveBeenLastCalledWith({
      window: '1h',
      kind: 'all',
      includeRoutine: true,
      failureGroupOffset: 25,
      failureGroupLimit: 25,
    })
    expect(review.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('group', { name: 'Tools · Failure Pattern 5' })).toBeDefined()

    fireEvent.click(review)
    expect(useActivityDataMock).toHaveBeenLastCalledWith({ window: '1h', kind: 'all', includeRoutine: true })
    expect(screen.queryByRole('group', { name: 'Tools · Failure Pattern 1' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Review failure patterns 1–5 of 30' }).getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'Review failure patterns 1–5 of 30' }))
    await user.click(screen.getByRole('combobox', { name: 'Activity kind' }))
    await user.click(screen.getByRole('option', { name: 'Tools' }))
    expect(screen.queryByRole('group', { name: 'Tools · Failure Pattern 1' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Review failure patterns 1–5 of 30' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('labels highlights on later failure pages as page-local rather than global top patterns', () => {
    useActivityDataMock.mockImplementation((options: unknown) => {
      const resource = activityWithFailurePatterns(5)
      const offset = (options as { failureGroupOffset?: number }).failureGroupOffset ?? 0
      return {
        ...resource,
        data: {
          ...resource.data!,
          failureGroupPage: {
            total: 30,
            offset,
            limit: 25,
            hasMore: offset === 0,
          },
        },
      }
    })
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = mock(() => undefined)

    try {
      render(<ActivityTab />)
      fireEvent.click(screen.getByRole('button', { name: 'Review failure patterns 1–5 of 30' }))
      fireEvent.click(screen.getByRole('button', { name: 'Next failure patterns' }))

      const attention = screen.getByRole('region', { name: 'Hiccups' })
      expect(within(attention).getByText('Patterns 26–30 of 30')).toBeDefined()
      const highlights = within(attention).getByRole('list', { name: /failure patterns/i })
      expect(highlights.getAttribute('aria-label')).toBe('Failure patterns on this page')
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('preserves expanded failure details and focus across the loading gap between pages', () => {
    const firstPage = activityWithFailurePatterns(5)
    const secondPageGroups = firstPage.data!.failureGroups.map((group, index) => {
      const position = index + 26
      const name = `failure.pattern.${position}`
      return {
        ...group,
        name,
        destination: name,
        latestFailure: group.latestFailure
          ? {
              ...group.latestFailure,
              id: `failure-pattern-${position}`,
              name,
            }
          : undefined,
      }
    })
    const loadedFirstPage: UseHealthResourceResult<UsageFeedData> = {
      ...firstPage,
      data: {
        ...firstPage.data!,
        failureGroupPage: { total: 30, offset: 0, limit: 25, hasMore: true },
      },
    }
    const loadedSecondPage: UseHealthResourceResult<UsageFeedData> = {
      ...firstPage,
      data: {
        ...firstPage.data!,
        failureGroups: secondPageGroups,
        failureGroupPage: { total: 30, offset: 25, limit: 25, hasMore: false },
      },
    }
    let resource = loadedFirstPage
    useActivityDataMock.mockImplementation(() => resource)

    const view = render(<ActivityTab />)
    fireEvent.click(screen.getByRole('button', { name: 'Review failure patterns 1–5 of 30' }))
    const next = screen.getByRole('button', { name: 'Next failure patterns' })
    next.focus()
    fireEvent.click(next)

    resource = { ...loadedSecondPage, data: null, loading: true }
    view.rerender(<ActivityTab />)
    expect(screen.getByRole('status', { name: 'Loading activity' })).toBeDefined()

    resource = loadedSecondPage
    view.rerender(<ActivityTab />)

    const hideSecondPage = screen.getByRole('button', { name: 'Hide failure details' })
    expect(hideSecondPage.getAttribute('aria-expanded')).toBe('true')
    const firstPatternOnSecondPage = screen.getByRole('group', { name: 'Tools · Failure Pattern 26' })
    expect(document.activeElement).toBe(firstPatternOnSecondPage)

    hideSecondPage.focus()
    fireEvent.click(hideSecondPage)
    resource = { ...loadedFirstPage, data: null, loading: true }
    view.rerender(<ActivityTab />)
    expect(screen.getByRole('status', { name: 'Loading activity' })).toBeDefined()

    resource = loadedFirstPage
    view.rerender(<ActivityTab />)

    const reviewFirstPage = screen.getByRole('button', { name: 'Review failure patterns 1–5 of 30' })
    expect(reviewFirstPage.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(reviewFirstPage)
  })

  it('stays in the compact summary when live failure patterns cross the highlight limit', () => {
    let patternCount = 5
    useActivityDataMock.mockImplementation(() => activityWithFailurePatterns(patternCount))
    const view = render(<ActivityTab />)

    fireEvent.click(screen.getByRole('button', { name: 'Review all 5 failure patterns' }))
    expect(screen.getByRole('group', { name: 'Tools · Failure Pattern 5' })).toBeDefined()

    patternCount = 3
    view.rerender(<ActivityTab />)
    expect(screen.queryByRole('group', { name: 'Tools · Failure Pattern 1' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Review all 3 failure patterns' }).getAttribute('aria-expanded')).toBe('false')
    expect(within(screen.getByRole('list', { name: 'Top failure patterns' })).getAllByRole('listitem')).toHaveLength(3)

    patternCount = 5
    view.rerender(<ActivityTab />)
    expect(screen.queryByRole('group', { name: 'Tools · Failure Pattern 1' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Review all 5 failure patterns' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('expands a failure group to every matching raw failure event', () => {
    useActivityDataMock.mockImplementation(() => activityDashboardData())

    render(<ActivityTab />)

    fireEvent.click(screen.getByRole('button', { name: 'Review all 3 failure patterns' }))
    const tools = screen.getByRole('group', { name: 'Tools · Search Query' })
    const expand = within(tools).getByRole('button', { name: 'View 2 failure events for Tools · Search Query' })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    expect(within(tools).queryByText('Earlier provider timeout')).toBeNull()

    fireEvent.click(expand)

    expect(expand.getAttribute('aria-expanded')).toBe('true')
    const events = within(tools).getByRole('list', { name: 'Failure events for Tools · Search Query' })
    expect(within(events).getAllByRole('listitem')).toHaveLength(2)
    expect(within(events).getByText('Earlier provider timeout')).toBeDefined()
    expect(events.querySelector('time[datetime="2026-07-13T11:40:00.000Z"]')).not.toBeNull()
    expect(events.querySelector('time[datetime="2026-07-13T11:50:00.000Z"]')).not.toBeNull()
  })

  it('keeps every grouped incident inspectable when its raw event fell outside the recent cap', () => {
    const base = activityData()
    const latestFailure: UsageFeedData['recent'][number] = {
      id: 'usage-route-failure-latest',
      ts: '2026-07-13T12:00:00.000Z',
      kind: 'rest',
      activityClass: 'user',
      name: '/api/plugins/tasks/task-42',
      agent: 'main',
      durationMs: 90,
      status: 'error',
      meta: {
        routePattern: '/api/plugins/tasks/:taskId',
        method: 'POST',
        error: 'Task update timed out',
      },
    }
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        totals: { count: 3, errors: 3, errorRate: 1 },
        outcomes: { failed: 3, unverified: 0, canceled: 0, succeeded: 0 },
        byKind: [
          { kind: 'mcp', total: 0, failures: 0 },
          { kind: 'rest', total: 3, failures: 3 },
          { kind: 'agent', total: 0, failures: 0 },
        ],
        failureGroups: [{
          kind: 'rest',
          name: '/api/plugins/tasks/:taskId',
          destination: '/api/plugins/tasks/:taskId',
          method: 'POST',
          attempts: 3,
          failures: 3,
          firstFailureAt: '2026-07-13T11:00:00.000Z',
          lastFailureAt: latestFailure.ts,
          agents: ['main'],
          unattributedFailures: 2,
          systemFailures: 0,
          medianFailureDurationMs: 90,
          latestFailure,
        }],
        failureGroupPage: { total: 1, offset: 0, limit: 25, hasMore: false },
        recent: [],
        recentFailures: [],
      },
    }))

    render(<ActivityTab />)

    fireEvent.click(screen.getByRole('button', { name: 'Review all 1 failure pattern' }))
    const group = screen.getByRole('group', { name: 'API · POST Tasks TaskId' })
    expect(within(group).getByText('Task update timed out')).toBeDefined()
    expect(within(group).getByText('main · Agent not recorded (2)')).toBeDefined()
    const expand = within(group).getByRole('button', { name: 'View 1 of 3 recent failure events for API · POST Tasks TaskId' })
    expect(expand.hasAttribute('disabled')).toBe(false)
    fireEvent.click(expand)
    expect(within(group).getByRole('list', { name: 'Failure events for API · POST Tasks TaskId' })).toBeDefined()
    expect(within(group).getByText('/api/plugins/tasks/task-42')).toBeDefined()
  })

  it('makes additional failure destinations discoverable with bounded paging', () => {
    const base = activityData()
    useActivityDataMock.mockImplementation(() => ({
      ...base,
      data: {
        ...base.data!,
        failureGroupPage: { total: 40, offset: 0, limit: 25, hasMore: true },
      },
    }))

    render(<ActivityTab />)

    expect(screen.getByText('Patterns 1–2 of 40')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Review failure patterns 1–2 of 40' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next failure patterns' }))
    expect(useActivityDataMock).toHaveBeenLastCalledWith({
      window: '1h',
      kind: 'all',
      includeRoutine: true,
      failureGroupOffset: 25,
      failureGroupLimit: 25,
    })
  })

  it('returns to the last valid failure-pattern page when live groups shrink', () => {
    const base = activityData()
    useActivityDataMock.mockImplementation((options: unknown) => {
      const offset = (options as { failureGroupOffset?: number }).failureGroupOffset ?? 0
      return {
        ...base,
        data: {
          ...base.data!,
          failureGroups: offset > 0 ? [] : base.data!.failureGroups,
          failureGroupPage: offset > 0
            ? { total: 2, offset, limit: 25, hasMore: false }
            : { total: 40, offset: 0, limit: 25, hasMore: true },
        },
      }
    })

    render(<ActivityTab />)
    fireEvent.click(screen.getByRole('button', { name: 'Review failure patterns 1–2 of 40' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next failure patterns' }))

    expect(useActivityDataMock.mock.calls.some(([options]) => (
      (options as { failureGroupOffset?: number }).failureGroupOffset === 25
    ))).toBe(true)
    expect(useActivityDataMock).toHaveBeenLastCalledWith({ window: '1h', kind: 'all', includeRoutine: true })
    expect(screen.queryByRole('group', { name: 'API · Search Reindex' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Review failure patterns 1–2 of 40' }))
    expect(screen.getByRole('group', { name: 'API · Search Reindex' })).toBeDefined()
  })

  it('keeps a quiet Activity introduction and filters available while its feed is loading', () => {
    useActivityDataMock.mockImplementation(() => ({
      ...activityData(),
      data: null,
      loading: true,
    }))

    render(<ActivityTab />)

    const identity = screen.getByRole('heading', { level: 2, name: 'Activity' })
    expect(identity.className).toContain('sr-only')
    expect(screen.queryByText('What is Bakin doing?')).toBeNull()
    const intro = screen.getByText(/tool calls?/i)
    expect(intro.textContent ?? '').not.toMatch(/\bevery\b/i)
    expect(intro.className).toContain('text-xs')
    expect(intro.className).toContain('leading-relaxed')
    expect(intro.className).toContain('text-muted-foreground/80')
    expect(screen.getByLabelText('Activity window')).toBeDefined()
    expect(screen.getByLabelText('Activity kind')).toBeDefined()
    expect(screen.getByRole('status').textContent).toContain('Loading activity…')
  })

  it('keeps the quiet Activity introduction and recovery action available when its feed fails', () => {
    useActivityDataMock.mockImplementation(() => ({
      ...activityData(),
      data: null,
      error: 'Activity feed unavailable',
    }))

    render(<ActivityTab />)

    const identity = screen.getByRole('heading', { level: 2, name: 'Activity' })
    expect(identity.className).toContain('sr-only')
    expect(screen.queryByText('What is Bakin doing?')).toBeNull()
    const intro = screen.getByText(/tool calls?/i)
    expect(intro.textContent ?? '').not.toMatch(/\bevery\b/i)
    expect(screen.getByLabelText('Activity window')).toBeDefined()
    expect(screen.getByLabelText('Activity kind')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('Activity feed unavailable')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined()
  })
})
