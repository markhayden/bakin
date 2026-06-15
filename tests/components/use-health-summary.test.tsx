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

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { useHealthSummary } from '../../plugins/health/hooks/use-health-summary'

function Probe() {
  const { errors } = useHealthSummary()
  return <span data-testid="errors">{errors === null ? 'null' : String(errors)}</span>
}

const fetchMock = mock()

beforeEach(() => {
  fetchMock.mockReset()
  ;(globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
})

function summaryResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('useHealthSummary', () => {
  it('extracts doctor.summary.errors', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ doctor: { summary: { errors: 3, warnings: 5 } } }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('errors').textContent).toBe('3'))
  })

  it('returns 0 when doctor is null', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ doctor: null }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('errors').textContent).toBe('0'))
  })

  it('returns 0 when the summary has no errors field', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ doctor: { summary: { warnings: 2 } } }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('errors').textContent).toBe('0'))
  })

  it('refetches on a doctor.run event', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ doctor: { summary: { errors: 1 } } }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('errors').textContent).toBe('1'))

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(summaryResponse({ doctor: { summary: { errors: 4 } } }))
    act(() => { emitPluginEvent({ event: 'doctor.run' }) })
    await waitFor(() => expect(screen.getByTestId('errors').textContent).toBe('4'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the last good value on a failed fetch', async () => {
    fetchMock.mockResolvedValue(summaryResponse({ doctor: { summary: { errors: 2 } } }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('errors').textContent).toBe('2'))

    fetchMock.mockRejectedValue(new Error('network down'))
    act(() => { emitPluginEvent({ event: 'doctor.run' }) })
    // Value is retained (no throw, no reset to null).
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByTestId('errors').textContent).toBe('2')
  })
})
