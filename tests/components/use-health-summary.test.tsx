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
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('useHealthSummary', () => {
  it('counts unique non-advisory incidents and uses the urgent tone', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ sensitivity: 'standard', incidents: [
      { id: 'action', effectiveDisposition: 'action_required' },
      { id: 'action', effectiveDisposition: 'action_required' },
      { id: 'watch', effectiveDisposition: 'watch' },
      { id: 'advisory', effectiveDisposition: 'advisory' },
    ] }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2:error'))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/plugins/health/doctor')
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('uses attention when only watch incidents remain', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ sensitivity: 'standard', incidents: [{ id: 'watch', effectiveDisposition: 'watch' }] }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1:attention'))
  })

  it('returns zero when only advisories exist', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ sensitivity: 'standard', incidents: [{ id: 'info', effectiveDisposition: 'advisory' }] }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0:attention'))
  })

  it('refetches on a health.report.changed event', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ sensitivity: 'standard', incidents: [{ id: 'watch', effectiveDisposition: 'watch' }] }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1:attention'))

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(summaryResponse({ sensitivity: 'standard', incidents: [
      { id: 'one', effectiveDisposition: 'action_required' },
      { id: 'two', effectiveDisposition: 'watch' },
    ] }))
    act(() => { emitPluginEvent({ event: 'health.report.changed' }) })
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2:error'))
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

  it('a legacy payload (no sensitivity/effectiveDisposition) still badges via raw disposition', async () => {
    // Client/server version skew must degrade to the raw story — a blanked
    // badge would hide real action_required incidents.
    fetchMock.mockResolvedValue(summaryResponse({ incidents: [
      { id: 'action', disposition: 'action_required' },
      { id: 'advisory', disposition: 'advisory' },
    ] }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1:error'))
  })

  it('quiet mode badges only action_required — watch stays silent (D10)', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ sensitivity: 'quiet', incidents: [
      { id: 'watch', effectiveDisposition: 'watch' },
      { id: 'another-watch', effectiveDisposition: 'watch' },
    ] }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0:attention'))
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
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2:error'))
    expect(firstSignal.aborted).toBe(true)

    await act(async () => {
      first.resolve(summaryResponse({ sensitivity: 'standard', incidents: [{ id: 'old', effectiveDisposition: 'watch' }] }))
      await first.promise
    })
    expect(screen.getByTestId('count').textContent).toBe('2:error')
  })
})
