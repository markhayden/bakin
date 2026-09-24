// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-use-health-summary-${Date.now()}`)

// Defensive content-dir mocks per CLAUDE.md.
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

// The hook refetches on each 'doctor.run' plugin event. Expose the real
// usePluginEvent through the SDK barrel so the test can drive it via emit.
import { usePluginEvent, emitPluginEvent } from '@/hooks/use-plugin-event'
mock.module('@makinbakin/sdk/hooks', () => ({ usePluginEvent }))

import { act, render, screen, waitFor } from '@testing-library/react'
import '../rtl-settle'
import { healthReportSchema } from '../../plugins/health/lib/route-schemas'
import { makeTeamHealthReport, TEAM_ATTENTION_HEALTH_REPORT } from '../plugins/team/health-report-fixture'
import { useHealthSummary } from '../../plugins/health/hooks/use-health-summary'

function Probe() {
  const { count, tone } = useHealthSummary()
  return <span data-testid="count">{count === null ? 'null' : `${count}:${tone}`}</span>
}

const fetchMock = mock()

beforeEach(() => {
  fetchMock.mockReset()
  ;(globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
})

function summaryResponse(body: unknown) {
  const value = body as { sensitivity?: 'standard' | 'quiet' | 'developer'; incidents: Array<Record<string, unknown>> }
  const full = makeTeamHealthReport({ sensitivity: value.sensitivity ?? 'standard', incidents: value.incidents.map((item) => ({
    status: 'warning', disposition: 'watch', title: 'Finding', impact: 'Review this finding',
    resources: [], resolution: { key: 'rerun', type: 'rerun', label: 'Run checks' }, observationIds: [],
    observedAt: '2026-07-13T12:00:00.000Z', staleAt: '2099-07-13T12:00:00.000Z', stale: false, ...item,
  })) as unknown as ReturnType<typeof makeTeamHealthReport>['incidents'] })
  full.observations = full.incidents.map((incident) => ({
    ...TEAM_ATTENTION_HEALTH_REPORT.observations[1]!,
    id: `obs:${incident.id}`, incidentId: incident.id,
  })) as ReturnType<typeof makeTeamHealthReport>['observations']
  for (const incident of full.incidents) incident.observationIds = [`obs:${incident.id}`]
  full.summary.incidents = {
    actionRequired: full.incidents.filter((i) => i.effectiveDisposition === 'action_required' && !i.ackState).length,
    watching: full.incidents.filter((i) => i.effectiveDisposition === 'watch' && !i.ackState).length,
    advisory: full.incidents.filter((i) => i.effectiveDisposition === 'advisory' && !i.ackState).length,
    acknowledged: full.incidents.filter((i) => i.ackState).length, unknown: 0,
  }
  if (value.incidents.every((i) => i.effectiveDisposition)) healthReportSchema.parse(full)
  return new Response(JSON.stringify(full), { status: 200, headers: { 'content-type': 'application/json' } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('useHealthSummary', () => {
  it('counts unique action-required incidents and uses the urgent tone', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ sensitivity: 'standard', incidents: [
      { id: 'action', effectiveDisposition: 'action_required' },
      { id: 'watch', effectiveDisposition: 'watch' },
      { id: 'advisory', effectiveDisposition: 'advisory' },
    ] }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1:error'))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/plugins/health/doctor')
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('stays silent when only watch incidents remain', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ sensitivity: 'standard', incidents: [{ id: 'watch', effectiveDisposition: 'watch' }] }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0:error'))
  })

  it('returns zero when only advisories exist', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ sensitivity: 'standard', incidents: [{ id: 'info', effectiveDisposition: 'advisory' }] }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0:error'))
  })

  it('refetches on a health.report.changed event', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ sensitivity: 'standard', incidents: [{ id: 'watch', effectiveDisposition: 'watch' }] }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0:error'))

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(summaryResponse({ sensitivity: 'standard', incidents: [
      { id: 'one', effectiveDisposition: 'action_required' },
      { id: 'two', effectiveDisposition: 'watch' },
    ] }))
    act(() => { emitPluginEvent({ event: 'health.report.changed' }) })
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1:error'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the last good value on a failed fetch', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ sensitivity: 'standard', incidents: [{ id: 'one', effectiveDisposition: 'action_required' }] }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1:error'))

    fetchMock.mockRejectedValue(new Error('network down'))
    act(() => { emitPluginEvent({ event: 'health.report.changed' }) })
    // Value is retained (no throw, no reset to null).
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByTestId('count').textContent).toBe('1:error')
  })

  it('rejects incomplete legacy incident payloads instead of inventing disposition', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ incidents: [{ id: 'action', disposition: 'action_required' }] }))
    render(<Probe />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByTestId('count').textContent).toBe('null')
  })

  it('quiet mode badges only action_required — watch stays silent (D10)', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ sensitivity: 'quiet', incidents: [
      { id: 'watch', effectiveDisposition: 'watch' },
      { id: 'another-watch', effectiveDisposition: 'watch' },
    ] }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0:error'))
  })

  it('quiet mode still pages for action_required', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ sensitivity: 'quiet', incidents: [
      { id: 'runaway', effectiveDisposition: 'action_required' },
      { id: 'watch', effectiveDisposition: 'watch' },
    ] }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1:error'))
  })

  it('supersedes an older request when a newer report event arrives', async () => {
    const first = deferred<Response>()
    fetchMock
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(summaryResponse({ sensitivity: 'standard', incidents: [
        { id: 'action', effectiveDisposition: 'action_required' },
        { id: 'watch', effectiveDisposition: 'watch' },
      ] }))
    render(<Probe />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal

    act(() => { emitPluginEvent({ event: 'health.report.changed' }) })
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1:error'))
    expect(firstSignal.aborted).toBe(true)

    await act(async () => {
      first.resolve(summaryResponse({ sensitivity: 'standard', incidents: [{ id: 'old', effectiveDisposition: 'watch' }] }))
      await first.promise
    })
    expect(screen.getByTestId('count').textContent).toBe('1:error')
  })
})

it('reconciles an alert resolved while disconnected without opening Health', async () => {
  fetchMock.mockResolvedValue(summaryResponse({ incidents: [{ id: 'action', effectiveDisposition: 'action_required' }] }))
  render(<Probe />)
  await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1:error'))
  fetchMock.mockResolvedValue(summaryResponse({ incidents: [] }))
  await act(async () => { emitPluginEvent({ event: 'bakin.reconcile' }) })
  await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0:error'))
})
