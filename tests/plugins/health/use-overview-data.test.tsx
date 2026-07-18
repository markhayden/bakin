// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { HealthReport, SearchReadiness } from '@makinbakin/sdk/types'
import '../../rtl-settle'

import { usePluginEvent } from '../../../src/hooks/use-plugin-event'
mock.module('@makinbakin/sdk/hooks', () => ({ usePluginEvent }))

import { useOverviewData } from '../../../plugins/health/hooks/use-overview-data'

const originalFetch = globalThis.fetch
const OBSERVED_AT = '2026-07-13T11:55:00.000Z'
const STALE_AT = '2099-07-13T12:00:00.000Z'

function readiness(status: SearchReadiness['status']): SearchReadiness {
  return {
    status,
    summary: status === 'degraded' ? 'Search is operating with a backlog.' : 'Search is ready.',
    observedAt: OBSERVED_AT,
    staleAt: STALE_AT,
    incidentIds: [],
    stages: (['engine', 'queries', 'indexes', 'journal'] as const).map((key) => ({
      key,
      label: key[0]!.toUpperCase() + key.slice(1),
      status: key === 'journal' && status === 'degraded' ? 'degraded' as const : 'healthy' as const,
      summary: key === 'journal' && status === 'degraded' ? 'Writes are delayed.' : `${key} is ready.`,
      observedAt: OBSERVED_AT,
      staleAt: STALE_AT,
      observationIds: [],
    })),
  }
}

function report(id: string, search: SearchReadiness): HealthReport {
  return {
    id,
    revision: id === 'report-1' ? 1 : 2,
    generatedAt: '2026-07-13T12:00:00.000Z',
    overallStatus: search.status === 'degraded' ? 'degraded' : 'healthy',
    sensitivity: 'developer',
    lastFullSweep: { id: `sweep:${id}`, startedAt: OBSERVED_AT, completedAt: OBSERVED_AT },
    checks: [],
    observations: [],
    incidents: [],
    subsystems: { search },
    summary: {
      checks: { registered: 0, completed: 0, failed: 0, invalid: 0, notApplicable: 0 },
      incidents: { actionRequired: 0, watching: 0, advisory: 0, unknown: 0 },
    },
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('useOverviewData', () => {
  it('loads only Overview facts and reconciles a newer canonical Search projection', async () => {
    const first = report('report-1', readiness('healthy'))
    const second = report('report-2', readiness('degraded'))
    let doctorReads = 0
    let invalidInteractions = false
    let invalidSummary = false
    let invalidReadiness = false
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/plugins/health/doctor') {
        doctorReads += 1
        return jsonResponse(doctorReads === 1 ? first : second)
      }
      if (url === '/api/plugins/health/summary') {
        return jsonResponse({
          errors1h: { total: invalidSummary ? -1 : 2, byKind: { mcp: 1, rest: 1, agent: 0 } },
          activeSessions: [{ agent: 'main', sessions: 3, connectedAt: OBSERVED_AT }],
          upSince: OBSERVED_AT,
          server: null,
        })
      }
      if (url === '/api/plugins/health/live-now') {
        return jsonResponse({
          generatedAt: OBSERVED_AT,
          runs: [{ agent: 'main', taskId: 'task-1', taskTitle: 'Task', runId: 'run-1', startedAt: 1, runningForMs: 2, heartbeatAgeMs: 3 }],
        })
      }
      if (url === '/api/plugins/health/search-readiness') {
        return jsonResponse({ reportId: invalidReadiness ? 42 : second.id, readiness: second.subsystems.search })
      }
      if (url === '/api/plugins/health/usage-history?window=24h') {
        return jsonResponse({
          window: '24h', since: '2026-07-12', throughDay: '2026-07-13', scannedAt: OBSERVED_AT,
          byAgent: [], byDay: [], byAgentDay: [],
        })
      }
      if (url === '/api/plugins/health/agent-effort?window=24h') {
        return jsonResponse({ window: '24h', scannedAt: OBSERVED_AT, agents: [] })
      }
      if (url === '/api/plugins/health/usage-snapshot') {
        return jsonResponse({
          generatedAt: OBSERVED_AT,
          source: { status: 'complete', reason: 'complete', failedAgents: [] },
          sessions: [],
        })
      }
      if (url === '/api/plugins/health/interaction-summary?window=1h') {
        const payload = {
          window: '1h',
          coverage: { startsAt: '2026-07-13T11:00:00.000Z', hasFullWindow: true, reason: 'full_window' },
          totals: { count: 18, errors: 1, unverified: 2, foreground: 8, background: 10 },
          categories: [
            { key: 'tools', count: 8, errors: 0 },
            { key: 'api', count: 7, errors: 1 },
            { key: 'agents', count: 3, errors: 0 },
          ],
          topDestinations: [],
          timeBuckets: [
            { start: OBSERVED_AT, count: 18, failureCount: 1, failureRate: 1 / 18 },
          ],
        }
        if (invalidInteractions) {
          return jsonResponse({ ...payload, coverage: undefined })
        }
        return jsonResponse(payload)
      }
      if (url === '/api/context-report') {
        return jsonResponse({ ok: true, tokenEstimateNote: 'approximate', agents: [] })
      }
      if (url === '/api/settings') {
        return jsonResponse({ dispatch: { contextBudgetBytes: 65_536 } })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { result } = renderHook(() => useOverviewData())

    await waitFor(() => expect(result.current.report.data?.id).toBe('report-2'))
    expect(doctorReads).toBe(2)
    expect(result.current.model.search.status).toBe('degraded')
    expect(result.current.model.rightNow).toMatchObject({
      runningDispatches: 1,
      connectedSessions: 3,
      recentFailures: 2,
    })
    expect(result.current.agents.history.data?.window).toBe('24h')
    expect(result.current.interactions.data?.coverage).toEqual({
      startsAt: '2026-07-13T11:00:00.000Z',
      hasFullWindow: true,
      reason: 'full_window',
    })
    expect(result.current.interactions.data?.totals).toEqual({ count: 18, errors: 1, unverified: 2, foreground: 8, background: 10 })
    expect(result.current.contextReport.data?.ok).toBe(true)
    expect(result.current.settings.data?.dispatch?.contextBudgetBytes).toBe(65_536)
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual(expect.arrayContaining([
      '/api/plugins/health/doctor',
      '/api/plugins/health/summary',
      '/api/plugins/health/live-now',
      '/api/plugins/health/search-readiness',
      '/api/plugins/health/usage-history?window=24h',
      '/api/plugins/health/usage-snapshot',
      '/api/plugins/health/interaction-summary?window=1h',
      '/api/context-report',
      '/api/settings',
    ]))
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).not.toContain(
      '/api/plugins/health/agent-effort?window=24h',
    )

    invalidInteractions = true
    await act(async () => { await result.current.interactions.refresh('background') })
    await waitFor(() => expect(result.current.interactions.backgroundError).toContain('invalid response'))
    expect(result.current.interactions.data?.totals.count).toBe(18)
    expect(result.current.backgroundError).toContain('Interaction activity returned an invalid response')

    invalidSummary = true
    await act(async () => { await result.current.summary.refresh('background') })
    await waitFor(() => expect(result.current.summary.backgroundError).toContain('invalid response'))
    expect(result.current.summary.data?.errors1h?.total).toBe(2)

    invalidReadiness = true
    await act(async () => { await result.current.searchReadiness.refresh('background') })
    await waitFor(() => expect(result.current.searchReadiness.backgroundError).toContain('invalid response'))
    expect(result.current.searchReadiness.data?.reportId).toBe(second.id)
  })
})
