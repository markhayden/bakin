// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { renderHook, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { useActivityData } from '../../../plugins/health/hooks/use-activity-data'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('useActivityData exact failure targeting', () => {
  it('only sends the additive target params after the server advertises support', async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL) => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const target = { kind: 'mcp' as const, method: null, destination: 'web.search' }

    const { rerender } = renderHook(
      ({ supported }: { supported: boolean }) => useActivityData({
        window: '1h',
        kind: 'all',
        includeRoutine: true,
        failureGroupTarget: target,
        exactFailureTargetingSupported: supported,
      }),
      { initialProps: { supported: false } },
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('failureGroupTarget')

    rerender({ supported: true })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const request = new URL(String(fetchMock.mock.calls[1]?.[0]), 'http://localhost')
    expect(request.searchParams.get('failureGroupTargetKind')).toBe('mcp')
    expect(request.searchParams.get('failureGroupTargetMethod')).toBe('')
    expect(request.searchParams.get('failureGroupTargetDestination')).toBe('web.search')
  })
})
