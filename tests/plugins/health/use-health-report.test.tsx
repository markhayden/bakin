// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { HealthReport } from '@makinbakin/sdk/types'
import '../../rtl-settle'

import { emitPluginEvent, usePluginEvent } from '../../../src/hooks/use-plugin-event'
mock.module('@makinbakin/sdk/hooks', () => ({ usePluginEvent }))

import {
  HEALTH_REPORT_SWEEP_TIMEOUT_MS,
  useHealthReport,
} from '../../../plugins/health/hooks/use-health-report'

const originalFetch = globalThis.fetch
const originalSetInterval = globalThis.setInterval
const originalClearInterval = globalThis.clearInterval

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function report(overrides: Partial<HealthReport> = {}): HealthReport {
  const generatedAt = '2026-07-13T12:00:00.000Z'
  return {
    id: 'report-1',
    revision: 1,
    generatedAt,
    overallStatus: 'healthy',
    sensitivity: 'developer',
    lastFullSweep: { id: 'sweep-1', startedAt: generatedAt, completedAt: generatedAt },
    checks: [],
    observations: [],
    incidents: [],
    subsystems: {
      search: {
        status: 'healthy', summary: 'Search is ready.', observedAt: generatedAt,
        staleAt: '2099-07-13T13:00:00.000Z', incidentIds: [],
        stages: (['engine', 'queries', 'indexes', 'journal'] as const).map((key) => ({
          key,
          label: key[0]!.toUpperCase() + key.slice(1),
          status: 'healthy' as const,
          summary: `${key} is ready.`,
          observedAt: generatedAt,
          staleAt: '2099-07-13T13:00:00.000Z',
          observationIds: [],
        })),
      },
    },
    summary: {
      checks: { registered: 0, completed: 0, failed: 0, invalid: 0, notApplicable: 0 },
      incidents: { actionRequired: 0, watching: 0, advisory: 0, unknown: 0, acknowledged: 0 },
    },
    ...overrides,
  }
}

beforeEach(() => {
  globalThis.fetch = originalFetch
  globalThis.setInterval = originalSetInterval
  globalThis.clearInterval = originalClearInterval
})

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.setInterval = originalSetInterval
  globalThis.clearInterval = originalClearInterval
})

describe('useHealthReport', () => {
  it('allows the longest registered check to finish before the client deadline', () => {
    expect(HEALTH_REPORT_SWEEP_TIMEOUT_MS).toBeGreaterThan(120_000)
  })

  it('refreshes the cached report every 60 seconds and on health.report.changed', async () => {
    let intervalCallback: (() => void) | null = null
    globalThis.setInterval = mock((callback: TimerHandler, interval?: number) => {
      if (interval === 60_000) intervalCallback = callback as () => void
      return originalSetInterval(callback, interval)
    }) as unknown as typeof setInterval
    const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(report()))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    renderHook(() => useHealthReport())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(intervalCallback).not.toBeNull()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/plugins/health/doctor')

    act(() => { emitPluginEvent({ event: 'health.report.changed' }) })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    act(() => { intervalCallback?.() })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls.every((call) => call[0] === '/api/plugins/health/doctor')).toBe(true)
  })

  it('runs fresh checks explicitly and joins repeated clicks', async () => {
    const fresh = deferred<Response>()
    const fetchMock = mock()
      .mockResolvedValueOnce(jsonResponse(report()))
      .mockImplementationOnce(() => fresh.promise)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { result } = renderHook(() => useHealthReport())
    await waitFor(() => expect(result.current.data?.id).toBe('report-1'))

    let first!: Promise<HealthReport | null>
    let second!: Promise<HealthReport | null>
    act(() => {
      first = result.current.runChecks()
      second = result.current.runChecks()
    })

    expect(first).toBe(second)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/plugins/health/doctor/run')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(result.current.refreshing).toBe(true)

    await act(async () => { fresh.resolve(jsonResponse(report({ id: 'report-2', revision: 2 }))) })
    expect(result.current.data?.id).toBe('report-2')
  })

  it('leaves automatic stale-evidence refresh to the server and runs checks only explicitly', async () => {
    const stale = report({ overallStatus: 'unknown_stale' })
    const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(stale))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { result } = renderHook(() => useHealthReport())
    await waitFor(() => expect(result.current.data?.id).toBe('report-1'))
    expect(result.current.stale).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await result.current.runChecks() })
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/plugins/health/doctor/run')
  })

  it('runs diagnostics instead of joining a cached reconciliation read', async () => {
    const cached = deferred<Response>()
    const fetchMock = mock()
      .mockResolvedValueOnce(jsonResponse(report()))
      .mockImplementationOnce(() => cached.promise)
      .mockResolvedValueOnce(jsonResponse(report({ revision: 3 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { result } = renderHook(() => useHealthReport())
    await waitFor(() => expect(result.current.data?.revision).toBe(1))

    act(() => { emitPluginEvent({ event: 'bakin.reconcile' }) })
    let explicit!: Promise<HealthReport | null>
    act(() => { explicit = result.current.runChecks() })
    // Resolve even if the transport ignores abort; the old snapshot must lose.
    await act(async () => { cached.resolve(jsonResponse(report({ revision: 2 }))); await explicit })

    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/plugins/health/doctor/run')
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('POST')
    expect(result.current.data?.revision).toBe(3)
  })

  it('finishes a manual sweep despite report events and coalesces a follow-up snapshot', async () => {
    const sweep = deferred<Response>()
    const snapshot = deferred<Response>()
    const fetchMock = mock()
      .mockResolvedValueOnce(jsonResponse(report()))
      .mockImplementationOnce(() => sweep.promise)
      .mockImplementationOnce(() => snapshot.promise)
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { result } = renderHook(() => useHealthReport())
    await waitFor(() => expect(result.current.data?.revision).toBe(1))

    let explicit!: Promise<HealthReport | null>
    act(() => { explicit = result.current.runChecks() })
    const signal = fetchMock.mock.calls[1]?.[1]?.signal as AbortSignal
    act(() => {
      emitPluginEvent({ event: 'health.report.changed' })
      emitPluginEvent({ event: 'health.report.changed' })
      emitPluginEvent({ event: 'bakin.reconcile' })
    })
    const aborted = signal.aborted
    const readsDuringSweep = fetchMock.mock.calls.length
    let completed: HealthReport | null = null
    await act(async () => {
      sweep.resolve(jsonResponse(report({ revision: 2 })))
      completed = await explicit
      snapshot.resolve(jsonResponse(report({ revision: 3 })))
    })

    expect(aborted).toBe(false)
    expect(readsDuringSweep).toBe(2)
    expect(completed).toMatchObject({ revision: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/plugins/health/doctor')
    expect(result.current.data?.revision).toBe(3)
  })

  it('retains the last report when an event-driven background refresh fails', async () => {
    const fetchMock = mock()
      .mockResolvedValueOnce(jsonResponse(report()))
      .mockRejectedValueOnce(new Error('event refresh failed'))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { result } = renderHook(() => useHealthReport())
    await waitFor(() => expect(result.current.data?.id).toBe('report-1'))

    act(() => { emitPluginEvent({ event: 'health.report.changed' }) })
    await waitFor(() => expect(result.current.backgroundError).toBe('event refresh failed'))
    expect(result.current.data?.id).toBe('report-1')
    expect(result.current.error).toBeNull()
    expect(result.current.stale).toBe(true)
  })

  it('rejects a report that only passes a shallow shape check', async () => {
    const invalid = report({ revision: -1 })
    globalThis.fetch = mock(async () => jsonResponse(invalid)) as unknown as typeof fetch

    const { result } = renderHook(() => useHealthReport())

    await waitFor(() => expect(result.current.error).toBe('Health report response was invalid'))
    expect(result.current.data).toBeNull()
  })
})
