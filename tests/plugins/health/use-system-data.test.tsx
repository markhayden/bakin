// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { HealthReport } from '@makinbakin/sdk/types'
import '../../rtl-settle'

import { usePluginEvent } from '../../../src/hooks/use-plugin-event'
// Captured BEFORE the module is mocked (live namespace binding): the SDK's render helpers (useKeyedState, useNow, useMediaQuery) stay real under the narrow mock.
import * as realSdkHooks from '@makinbakin/sdk/hooks'
mock.module('@makinbakin/sdk/hooks', () => ({
  ...realSdkHooks, usePluginEvent }))

import { useSystemData } from '../../../plugins/health/hooks/use-system-data'
import { useUpdatesResource } from '../../../plugins/health/hooks/use-updates'
import type { UseHealthResourceResult } from '../../../plugins/health/hooks/use-health-resource'
import type { UpdatesData } from '../../../plugins/health/lib/updates-route-schema'
import { finishedOperation, operationResponse, operationStarted } from '../../helpers/operation-fetch'

const originalFetch = globalThis.fetch
const OBSERVED_AT = '2026-07-13T11:55:00.000Z'
const STALE_AT = '2099-07-13T12:00:00.000Z'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
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

/** A settled, empty engine read: the System hook never fetches `/api/updates` itself (the page does). */
function updatesStub(): UseHealthResourceResult<UpdatesData> {
  return { data: { records: [], generatedAt: OBSERVED_AT, running: false }, error: null, backgroundError: null, loading: false, refreshing: false, refresh: mock(async () => null) }
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
      // The upgrade starts (#895), then Bakin restarts: the operation's read
      // answers 404 from another boot, so its outcome is unknown.
      if (url === '/api/plugins/upgrade') return new Response(JSON.stringify({ operationId: 'op-upgrade', bootId: 'boot-before' }), { status: 202 })
      if (url.startsWith('/api/operations/op-upgrade')) return new Response(JSON.stringify({ bootId: 'boot-after', error: 'not_found' }), { status: 404 })
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

    const { result } = renderHook(() => useSystemData(updatesStub()))
    await waitFor(() => expect(result.current.pluginManifest.data?.plugins).toHaveLength(1))

    await act(async () => { await result.current.upgradePlugin('notes') })
    await waitFor(() => expect(result.current.pluginMutation.status).toBe('outcome-unknown'))

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

/** Everything the System tab reads, healthy and quiet; `extra` answers anything else first. */
function systemFetch(extra: (url: string, init?: RequestInit) => Response | null) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const answer = extra(url, init)
    if (answer) return answer
    if (url.startsWith('/api/plugins/manifest')) {
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
      return jsonResponse({ windows: { '1h': emptyWindow, '24h': emptyWindow }, outbox: { pending: 0, quarantined: 0 }, enrichment: null })
    }
    if (url === '/api/plugins/health/registry') {
      return jsonResponse({ plugins: [{ id: 'notes', name: 'Notes', version: '1.0.0', description: 'Notes integration.', source: 'user', status: 'active', routes: 2 }] })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }) as unknown as typeof fetch
  return calls
}

describe('useSystemData plugin upgrade operations (#895)', () => {
  const upgradeBodies = (calls: Array<{ url: string; init?: RequestInit }>) => calls
    .filter((c) => c.url === '/api/plugins/upgrade')
    .map((c) => JSON.parse(String(c.init?.body)) as Record<string, unknown>)

  it('a preview with nothing to consent to commits at once with its token, then refreshes and succeeds', async () => {
    const operations = new Map([
      ['op-preview', finishedOperation('op-preview', { httpStatus: 200, body: { ok: true, ready: true, awaitingConsent: false, noop: false, declaredPermissions: [], declaredBins: [], consentToken: 'tok-ready' } })],
      ['op-commit', finishedOperation('op-commit', { httpStatus: 200, body: { ok: true, noop: false, awaitingConsent: false, declaredPermissions: [], declaredBins: [] } })],
    ])
    const calls = systemFetch((url, init) => {
      const op = operationResponse(url, operations)
      if (op) return op
      if (url === '/api/plugins/upgrade') {
        const body = JSON.parse(String(init?.body)) as { accepted?: boolean }
        return operationStarted(body.accepted ? 'op-commit' : 'op-preview')
      }
      return null
    })

    const { result } = renderHook(() => useSystemData(updatesStub()))
    await waitFor(() => expect(result.current.pluginManifest.data?.plugins).toHaveLength(1))
    await act(async () => { await result.current.upgradePlugin('notes') })

    await waitFor(() => expect(result.current.pluginMutation.status).toBe('success'))
    expect(result.current.pluginMutation.message).toBe('notes was updated and reactivated.')
    expect(upgradeBodies(calls)).toEqual([{ pluginId: 'notes' }, { pluginId: 'notes', accepted: true, consentToken: 'tok-ready' }])
  })

  it('a preview that needs consent asks first; approving runs the commit operation', async () => {
    const operations = new Map([
      ['op-preview', finishedOperation('op-preview', { httpStatus: 200, body: {
        ok: false, awaitingConsent: true, noop: false, declaredPermissions: ['storage.write'], declaredBins: [], consentToken: 'tok-consent',
      } })],
      ['op-commit', finishedOperation('op-commit', { httpStatus: 200, body: { ok: true, noop: false, awaitingConsent: false, declaredPermissions: ['storage.write'], declaredBins: [] } })],
    ])
    const calls = systemFetch((url, init) => {
      const op = operationResponse(url, operations)
      if (op) return op
      if (url === '/api/plugins/upgrade') {
        const body = JSON.parse(String(init?.body)) as { accepted?: boolean }
        return operationStarted(body.accepted ? 'op-commit' : 'op-preview')
      }
      return null
    })

    const { result } = renderHook(() => useSystemData(updatesStub()))
    await waitFor(() => expect(result.current.pluginManifest.data?.plugins).toHaveLength(1))
    await act(async () => { await result.current.upgradePlugin('notes') })
    await waitFor(() => expect(result.current.pluginMutation.status).toBe('confirmation'))
    expect(result.current.pluginMutation.permissions).toEqual(['storage.write'])
    expect(upgradeBodies(calls)).toHaveLength(1)

    await act(async () => { await result.current.upgradePlugin('notes', result.current.pluginMutation.consentToken) })
    await waitFor(() => expect(result.current.pluginMutation.status).toBe('success'))
    expect(upgradeBodies(calls).at(-1)).toEqual({ pluginId: 'notes', accepted: true, consentToken: 'tok-consent' })
  })
})

describe('useSystemData explicit update check (#1007 P10′)', () => {
  it('"Check for updates" runs the engine\'s plugin pass, then re-reads the records the row renders', async () => {
    let checked = 0
    let updatesReads = 0
    const calls = systemFetch((url, init) => {
      if (url === '/api/updates/check?wait=1&source=plugin' && init?.method === 'POST') {
        checked += 1
        return jsonResponse({ bootId: 'boot-1', ids: ['plugin:notes'], coalesced: false, records: [] })
      }
      if (url === '/api/updates') {
        updatesReads += 1
        const offered = checked > 0
        return jsonResponse({ bootId: 'boot-1', generatedAt: OBSERVED_AT, running: false, records: [{
          id: 'plugin:notes', group: 'available', subject: { kind: 'plugin', id: 'notes', label: 'notes' },
          installed: { version: '1.0.0', display: '1.0.0' }, fingerprint: 'fp',
          source: { kind: 'artifact-index', endpoint: 'https://example.test/index.json' }, observedAt: OBSERVED_AT,
          ...(offered
            ? { available: { version: '1.1.0', display: '1.1.0' }, reason: 'newer-version', outcome: 'update-available', action: { kind: 'operation', start: { route: '/api/updates/plugin%3Anotes/apply' }, impact: ['download'] } }
            : { outcome: 'current' }),
        }] })
      }
      return null
    })

    const { result } = renderHook(() => useSystemData(useUpdatesResource()))
    await waitFor(() => expect(result.current.updates.data?.records).toHaveLength(1))
    expect(result.current.updates.data?.records[0]?.outcome).toBe('current')

    await act(async () => { await result.current.checkPluginUpdates() })

    expect(checked).toBe(1)
    expect(updatesReads).toBe(2)
    expect(result.current.updates.data?.records[0]?.outcome).toBe('update-available')
    expect(result.current.checkingUpdates).toBe(false)
    // The manifest is read plainly — the old `?check=1` probe is gone.
    expect(calls.filter((c) => c.url.startsWith('/api/plugins/manifest')).every((c) => !c.url.includes('check='))).toBe(true)
  })

  it('a failed engine check is the plugin mutation\'s error, never a silent "nothing new"', async () => {
    systemFetch((url, init) => {
      if (url === '/api/updates/check?wait=1&source=plugin' && init?.method === 'POST') return jsonResponse({ error: 'updates_unavailable', message: 'The updates engine has not started on this server.' }, 503)
      if (url === '/api/updates') return jsonResponse({ bootId: 'boot-1', generatedAt: OBSERVED_AT, running: false, records: [] })
      return null
    })
    const { result } = renderHook(() => useSystemData(useUpdatesResource()))
    await waitFor(() => expect(result.current.updates.data).not.toBeNull())
    await act(async () => { expect(await result.current.checkPluginUpdates()).toBeNull() })
    expect(result.current.pluginMutation).toMatchObject({ status: 'error', message: 'Could not check for plugin updates: The updates engine has not started on this server.' })
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

    const { result } = renderHook(() => useSystemData(updatesStub()))

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
