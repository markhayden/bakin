// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
      totals: { count: 9, errors: 4, errorRate: 4 / 9 },
      topByName: [
        { name: 'search.query', count: 5, errors: 3, medianDurationMs: 22 },
        { name: 'dispatch', count: 2, errors: 1, medianDurationMs: 48 },
        { name: 'web.search', count: 1, errors: 0, medianDurationMs: 25 },
      ],
      byAgent: [
        { agent: 'main', count: 4, errors: 2, lastActivity: null },
        { agent: 'patch', count: 3, errors: 1, lastActivity: null },
        { agent: 'scout', count: 2, errors: 1, lastActivity: null },
      ],
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
    const needsAttention = within(tab).getByRole('region', { name: 'Needs attention' })
    expect(pulse.compareDocumentPosition(needsAttention) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(tab).queryByText('Failure rate')).toBeNull()

    expect(within(needsAttention).queryByText('Technical details')).toBeNull()
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

    const chart = screen.getByRole('group', { name: 'Failures over time' })
    expect(chart.getAttribute('viewBox')).toBe('0 0 640 120')
    expect(chart.closest('[data-activity-failure-trend-plot]')?.className).toContain('max-w-4xl')

    const table = screen.getByRole('table', { name: 'Failures over time data' })
    expect(within(table).getByText('Failures')).toBeDefined()
    expect(within(table).queryByText('All activity')).toBeNull()
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    const trend = chart.closest('section')
    expect(trend).not.toBeNull()
    if (!trend) return
    expect(within(trend).getByRole('note').textContent).toContain('latest interval')
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
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Failures over time' })).toBeNull()
    expect(screen.queryByText(/Successful activity \(/)).toBeNull()
    expect(screen.getByRole('region', { name: 'Activity over time' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Call breakdown' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Recent events' })).toBeDefined()
  })

  it('keeps an unobserved result in the Needs attention view without calling it healthy', () => {
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
    const attention = screen.getByRole('region', { name: 'Needs attention' })
    expect(within(attention).getByRole('heading', { name: 'Results to verify' })).toBeDefined()
    expect(within(attention).getByText('Web Search')).toBeDefined()
    expect(within(attention).getByText('Result not observed')).toBeDefined()
    const metrics = screen.getByRole('group', { name: 'Activity metrics' })
    expect(within(metrics).getByText('Needs attention')).toBeDefined()
    const successTile = within(metrics).getByText('Success rate').closest('[data-stat-tile]')
    expect(successTile?.querySelector('.bg-warning')).not.toBeNull()
    expect(successTile?.querySelector('.bg-success')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Failures over time' })).toBeNull()
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

  it('stores window and kind choices while routine successes stay included', () => {
    render(<ActivityTab />)

    fireEvent.change(screen.getByLabelText('Activity window'), { target: { value: '24h' } })
    fireEvent.change(screen.getByLabelText('Activity kind'), { target: { value: 'rest' } })

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
    expect(screen.getByRole('region', { name: 'Needs attention' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Failures over time' })).toBeDefined()
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
    expect(screen.getByRole('region', { name: 'Needs attention' })).toBeDefined()
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

      const attention = screen.getByRole('region', { name: 'Needs attention' })
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(document.activeElement).toBe(attention)

      view.rerender(<ActivityTab />)
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('keeps the activity chart and exact values visible together', () => {
    useActivityDataMock.mockImplementation(() => activityDashboardData())

    render(<ActivityTab />)

    const volume = screen.getByRole('region', { name: 'Activity over time' })
    expect(within(volume).getByRole('table', { name: 'Activity over time data' })).toBeDefined()
    expect(volume.getAttribute('data-chart-layout')).toBe('split')
  })

  it('keeps time and type filters explicit without introducing a lossy view mode', () => {
    render(<ActivityTab />)

    expect(screen.queryByRole('group', { name: 'Activity view' })).toBeNull()
    expect(screen.getByRole('option', { name: 'All types' }).getAttribute('value')).toBe('all')
    expect(screen.getByRole('option', { name: 'Last hour' }).getAttribute('value')).toBe('1h')
    expect(screen.getByRole('group', { name: 'Activity metrics' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Needs attention' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Failures over time' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Activity over time' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Recent events' })).toBeDefined()
    expect(screen.queryByRole('checkbox', { name: 'Include routine success' })).toBeNull()
  })

  it('lands on a metrics dashboard with volume and breakdown charts', () => {
    useActivityDataMock.mockImplementation(() => activityDashboardData())

    render(<ActivityTab />)

    const metrics = screen.getByRole('group', { name: 'Activity metrics' })
    expect(within(metrics).getByText('Interactions')).toBeDefined()
    expect(within(metrics).getByText('9')).toBeDefined()
    expect(within(metrics).getByText('Success rate')).toBeDefined()
    expect(within(metrics).getByText('33.3%')).toBeDefined()
    expect(within(metrics).getByText('Needs attention')).toBeDefined()
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
    expect(within(destinations).getAllByRole('listitem')).toHaveLength(3)
    expect(within(destinations).getByText(/3 failed/)).toBeDefined()
    const agents = within(breakdown).getByRole('list', { name: 'Busiest agents' })
    expect(within(agents).getAllByRole('listitem')).toHaveLength(3)
    expect(within(agents).getByText('main')).toBeDefined()

    expect(within(metrics).queryByRole('button', { name: /Needs attention/ })).toBeNull()
    expect(screen.getByRole('region', { name: 'Needs attention' })).toBeDefined()
  })

  it('keeps one compact chronological feed beside the incident details', () => {
    useActivityDataMock.mockImplementation(() => activityDashboardData())

    render(<ActivityTab />)

    expect(screen.queryByRole('button', { name: 'All events' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Needs attention' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Failures over time' })).toBeDefined()

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
    expect(screen.getByRole('region', { name: 'Needs attention' })).toBeDefined()
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
    expect(screen.getByRole('region', { name: 'Needs attention' })).toBeDefined()
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
    expect(screen.getByRole('region', { name: 'Needs attention' })).toBeDefined()
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
    expect(screen.getByRole('region', { name: 'Needs attention' })).toBeDefined()
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

    const needsAttention = screen.getByRole('heading', { name: 'Needs attention' })
    expect(pulse.compareDocumentPosition(needsAttention) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'All events' })).toBeNull()
  })

  it('groups Needs attention by kind and destination with recurrence, recency, agents, and latest reason', () => {
    useActivityDataMock.mockImplementation(() => activityDashboardData())

    render(<ActivityTab />)

    const needsAttention = screen.getByRole('region', { name: 'Needs attention' })
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

  it('previews the three highest-priority failure patterns and expands the remainder on demand', () => {
    useActivityDataMock.mockImplementation(() => activityWithFailurePatterns(5))

    render(<ActivityTab />)

    const attention = screen.getByRole('region', { name: 'Needs attention' })
    expect(within(attention).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual([
      'Tools · Failure Pattern 1',
      'Tools · Failure Pattern 2',
      'Tools · Failure Pattern 3',
    ])
    expect(within(attention).queryByRole('group', { name: 'Tools · Failure Pattern 4' })).toBeNull()

    const showMore = within(attention).getByRole('button', { name: 'Show 2 more failure patterns' })
    expect(showMore.getAttribute('aria-expanded')).toBe('false')
    expect(showMore.getAttribute('aria-controls')).toBe('activity-failure-pattern-list')
    expect(attention.querySelector('#activity-failure-pattern-list')).not.toBeNull()
    fireEvent.click(showMore)

    expect(within(attention).getAllByRole('group')).toHaveLength(5)
    expect(within(attention).getByRole('group', { name: 'Tools · Failure Pattern 5' })).toBeDefined()
    const showFewer = within(attention).getByRole('button', { name: 'Show fewer failure patterns' })
    expect(showFewer.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(showFewer)

    expect(within(attention).queryByRole('group', { name: 'Tools · Failure Pattern 4' })).toBeNull()
    expect(within(attention).getByRole('button', { name: 'Show 2 more failure patterns' })).toBeDefined()
  })

  it('returns to the three-pattern preview after paging or filtering an expanded list', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more failure patterns' }))
    expect(screen.getByRole('region', { name: 'Needs attention' }).querySelectorAll('[role="group"]')).toHaveLength(5)

    fireEvent.click(screen.getByRole('button', { name: 'Next failure patterns' }))
    expect(screen.getByRole('region', { name: 'Needs attention' }).querySelectorAll('[role="group"]')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Show 2 more failure patterns' }).getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more failure patterns' }))
    fireEvent.change(screen.getByLabelText('Activity kind'), { target: { value: 'mcp' } })
    expect(screen.getByRole('region', { name: 'Needs attention' }).querySelectorAll('[role="group"]')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Show 2 more failure patterns' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('stays collapsed when live failure patterns shrink below the preview limit and grow again', () => {
    let patternCount = 5
    useActivityDataMock.mockImplementation(() => activityWithFailurePatterns(patternCount))
    const view = render(<ActivityTab />)

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more failure patterns' }))
    expect(screen.getByRole('region', { name: 'Needs attention' }).querySelectorAll('[role="group"]')).toHaveLength(5)

    patternCount = 3
    view.rerender(<ActivityTab />)
    expect(screen.queryByRole('button', { name: /more failure patterns/i })).toBeNull()

    patternCount = 5
    view.rerender(<ActivityTab />)
    expect(screen.getByRole('region', { name: 'Needs attention' }).querySelectorAll('[role="group"]')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Show 2 more failure patterns' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('expands a failure group to every matching raw failure event', () => {
    useActivityDataMock.mockImplementation(() => activityDashboardData())

    render(<ActivityTab />)

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
    fireEvent.click(screen.getByRole('button', { name: 'Next failure patterns' }))

    expect(useActivityDataMock.mock.calls.some(([options]) => (
      (options as { failureGroupOffset?: number }).failureGroupOffset === 25
    ))).toBe(true)
    expect(useActivityDataMock).toHaveBeenLastCalledWith({ window: '1h', kind: 'all', includeRoutine: true })
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
    const intro = screen.getByText(/Review every tool call, API request, and agent run across Bakin/i)
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
    expect(screen.getByText(/Review every tool call, API request, and agent run across Bakin/i)).toBeDefined()
    expect(screen.getByLabelText('Activity window')).toBeDefined()
    expect(screen.getByLabelText('Activity kind')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('Activity feed unavailable')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined()
  })
})
