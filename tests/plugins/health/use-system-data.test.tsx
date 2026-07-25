// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { HealthReport } from '@makinbakin/sdk/types'
import '../../rtl-settle'

import { usePluginEvent } from '../../../src/hooks/use-plugin-event'
mock.module('@makinbakin/sdk/hooks', () => ({ usePluginEvent }))

import { useSystemData } from '../../../plugins/health/hooks/use-system-data'

const originalFetch = globalThis.fetch
const OBSERVED_AT = '2026-07-13T11:55:00.000Z'
const STALE_AT = '2099-07-13T12:00:00.000Z'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function healthReport(): HealthReport {
  return {
    id: 'report-1',
    revision: 1,
    generatedAt: OBSERVED_AT,
    overallStatus: 'healthy',
    sensitivity: 'developer',
    lastFullSweep: { id: 'sweep-1', startedAt: OBSERVED_AT, completedAt: OBSERVED_AT },
    checks: [],
    observations: [],
    incidents: [],
    subsystems: {
      search: {
        status: 'healthy',
        summary: 'Search is ready.',
        observedAt: OBSERVED_AT,
        staleAt: STALE_AT,
        incidentIds: [],
        stages: [],
      },
    },
    summary: {
      checks: { registered: 0, completed: 0, failed: 0, invalid: 0, notApplicable: 0 },
      incidents: { actionRequired: 0, watching: 0, advisory: 0, unknown: 0, acknowledged: 0 },
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('useSystemData mutation reconciliation', () => {
  it('keeps an unknown plugin outcome locked until a forced-fresh inventory succeeds', async () => {
    const olderManifest = deferred<Response>()
    const manifestSignals: AbortSignal[] = []
    let manifestReads = 0
    let failReconciliation = true

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/plugins/upgrade') return new Response('not-json', { status: 200 })
      if (url.startsWith('/api/plugins/manifest')) {
        manifestReads += 1
        manifestSignals.push(init?.signal as AbortSignal)
        if (manifestReads === 2) return await olderManifest.promise
        if (manifestReads >= 3 && failReconciliation) throw new Error('manifest refresh failed')
        return jsonResponse({ plugins: [{
          id: 'notes', name: 'Notes', version: '1.0.0', source: 'github', installed: { version: '1.0.0' },
          upgradeAvailable: true, staleHintDays: null, status: 'active',
        }] })
      }
      if (url === '/api/plugins/health/doctor') return jsonResponse(healthReport())
      if (url === '/api/plugins/health/summary') {
        return jsonResponse({ errors1h: { total: 0, byKind: { mcp: 0, rest: 0, agent: 0 } }, activeSessions: [], upSince: OBSERVED_AT, server: null })
      }
      if (url === '/api/plugins/health/search-status') return jsonResponse({ enabled: true, tables: [] })
      if (url === '/api/plugins/health/search-telemetry') {
        const emptyMetric = { count: 0, errors: 0, medianMs: null }
        const emptyWindow = { query: emptyMetric, drain: emptyMetric, enrich: emptyMetric }
        return jsonResponse({
          windows: { '1h': emptyWindow, '24h': emptyWindow },
          outbox: { pending: 0, quarantined: 0 },
          enrichment: null,
        })
      }
      if (url === '/api/plugins/health/registry') {
        return jsonResponse({ plugins: [{
          id: 'notes', name: 'Notes', version: '1.0.0', description: 'Notes integration.',
          source: 'user', status: 'active', routes: 2,
        }] })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }) as unknown as typeof fetch

    const { result } = renderHook(() => useSystemData())
    await waitFor(() => expect(result.current.pluginManifest.data?.plugins).toHaveLength(1))

    await act(async () => { await result.current.upgradePlugin('notes') })
    expect(result.current.pluginMutation.status).toBe('outcome-unknown')

    act(() => { void result.current.pluginManifest.refresh('background') })
    await waitFor(() => expect(manifestReads).toBe(2))

    let failedRefresh!: Promise<void>
    act(() => { failedRefresh = result.current.refreshSystemDetails() })
    await waitFor(() => expect(manifestReads).toBe(3))
    olderManifest.resolve(jsonResponse({ plugins: [] }))
    await act(async () => { await failedRefresh })

    expect(manifestSignals[1]?.aborted).toBe(true)
    expect(result.current.pluginMutation.status).toBe('outcome-unknown')

    failReconciliation = false
    await act(async () => { await result.current.refreshSystemDetails() })
    expect(result.current.pluginMutation.status).toBe('idle')
  })
})

describe('useSystemData response validation', () => {
  it('fails malformed nested Search and registry payloads honestly', async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/plugins/health/doctor') return jsonResponse(healthReport())
      if (url === '/api/plugins/health/summary') {
        return jsonResponse({
          errors1h: { total: -1, byKind: { mcp: 0, rest: 0, agent: 0 } },
          activeSessions: [],
          upSince: OBSERVED_AT,
          server: null,
        })
      }
      if (url === '/api/plugins/health/search-status') {
        return jsonResponse({
          enabled: true,
          tables: [{
            logical: 'bakin_assets', physical: 'bakin_assets_v1', schemaVersion: 1,
            state: 'active', phase: null, pluginId: 'assets', docCount: 1,
            lastIndexedAt: null, lastRebuildAt: null, journalPending: 0, healthy: true,
            legs: [{ name: 'text', totalIndexed: -1, rebuilding: false }],
          }],
        })
      }
      if (url === '/api/plugins/health/search-telemetry') {
        const malformedMetric = { count: 1, errors: 2, medianMs: 1 }
        const malformedWindow = {
          query: malformedMetric,
          drain: { count: 0, errors: 0, medianMs: null },
          enrich: { count: 0, errors: 0, medianMs: null },
        }
        return jsonResponse({
          windows: { '1h': malformedWindow, '24h': malformedWindow },
          outbox: { pending: 0, quarantined: 0 },
          enrichment: null,
        })
      }
      if (url === '/api/plugins/health/registry') {
        return jsonResponse({ plugins: [{
          id: 'broken', name: 'Broken', version: '1.0.0', description: 'Broken plugin.',
          source: 'user', status: 'failed', routes: 0, missingDependencies: [42],
        }] })
      }
      if (url.startsWith('/api/plugins/manifest')) return jsonResponse({ plugins: [{ id: 42 }] })
      throw new Error(`Unexpected URL: ${url}`)
    }) as unknown as typeof fetch

    const { result } = renderHook(() => useSystemData())

    await waitFor(() => {
      expect(result.current.searchStatus.error).toBe('Search status returned an invalid response')
      expect(result.current.searchTelemetry.error).toBe('Search telemetry returned an invalid response')
      expect(result.current.registry.error).toBe('Plugin registry returned an invalid response')
      expect(result.current.live.error).toBe('Live system facts returned an invalid response')
      expect(result.current.pluginManifest.error).toBe('Plugin manifest returned an invalid response')
    })
    expect(result.current.searchStatus.data).toBeNull()
    expect(result.current.searchTelemetry.data).toBeNull()
    expect(result.current.registry.data).toBeNull()
    expect(result.current.live.data).toBeNull()
    expect(result.current.pluginManifest.data).toBeNull()
  })
})
