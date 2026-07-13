// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { renderHook, waitFor } from '@testing-library/react'
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
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/plugins/health/doctor') {
        doctorReads += 1
        return jsonResponse(doctorReads === 1 ? first : second)
      }
      if (url === '/api/plugins/health/summary') {
        return jsonResponse({
          errors1h: { total: 2, byKind: { mcp: 1, rest: 1, agent: 0 } },
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
        return jsonResponse({ reportId: second.id, readiness: second.subsystems.search })
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
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual(expect.arrayContaining([
      '/api/plugins/health/doctor',
      '/api/plugins/health/summary',
      '/api/plugins/health/live-now',
      '/api/plugins/health/search-readiness',
    ]))
  })
})
