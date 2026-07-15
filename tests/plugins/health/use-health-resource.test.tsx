// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, renderHook, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { useHealthResource } from '../../../plugins/health/hooks/use-health-resource'

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  globalThis.fetch = originalFetch
})

afterEach(() => {
  vi.useRealTimers()
  globalThis.fetch = originalFetch
})

describe('useHealthResource', () => {
  it('keeps initial and background failures distinct while retaining the last good data', async () => {
    const fetchMock = mock()
      .mockResolvedValueOnce(jsonResponse({ value: 1 }))
      .mockRejectedValueOnce(new Error('refresh offline'))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { result } = renderHook(() => useHealthResource<{ value: number }>('/api/health'))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.data).toEqual({ value: 1 }))
    expect(result.current.error).toBeNull()

    await act(async () => { await result.current.refresh('background') })

    expect(result.current.data).toEqual({ value: 1 })
    expect(result.current.error).toBeNull()
    expect(result.current.backgroundError).toBe('refresh offline')
    expect(result.current.stale).toBe(true)
    expect(result.current.loading).toBe(false)
    expect(result.current.refreshing).toBe(false)
  })

  it('reports an initial failure without presenting it as a background error', async () => {
    globalThis.fetch = mock(async () => { throw new Error('first load failed') }) as unknown as typeof fetch

    const { result } = renderHook(() => useHealthResource('/api/health'))

    await waitFor(() => expect(result.current.error).toBe('first load failed'))
    expect(result.current.data).toBeNull()
    expect(result.current.backgroundError).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('aborts the old source and ignores its late response by request generation', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    const signals: AbortSignal[] = []
    const fetchMock = mock((_url: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal)
      return signals.length === 1 ? first.promise : second.promise
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useHealthResource<{ source: string }>(url),
      { initialProps: { url: '/api/one' } },
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    rerender({ url: '/api/two' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(signals[0]?.aborted).toBe(true)

    await act(async () => { second.resolve(jsonResponse({ source: 'two' })) })
    await waitFor(() => expect(result.current.data).toEqual({ source: 'two' }))

    // Simulate a transport that resolves despite aborting. The generation guard
    // must still prevent the old source from overwriting the current one.
    await act(async () => { first.resolve(jsonResponse({ source: 'one' })) })
    expect(result.current.data).toEqual({ source: 'two' })
  })

  it('joins concurrent explicit refreshes into one request', async () => {
    const refreshResponse = deferred<Response>()
    const fetchMock = mock()
      .mockResolvedValueOnce(jsonResponse({ value: 1 }))
      .mockImplementationOnce(() => refreshResponse.promise)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { result } = renderHook(() => useHealthResource<{ value: number }>('/api/health'))
    await waitFor(() => expect(result.current.data).toEqual({ value: 1 }))

    let first!: Promise<{ value: number } | null>
    let second!: Promise<{ value: number } | null>
    act(() => {
      first = result.current.refresh()
      second = result.current.refresh()
    })

    expect(first).toBe(second)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.refreshing).toBe(true)

    await act(async () => { refreshResponse.resolve(jsonResponse({ value: 2 })) })
    expect(result.current.data).toEqual({ value: 2 })
    expect(result.current.refreshing).toBe(false)
  })

  it('forces a post-mutation reconciliation read instead of joining older work', async () => {
    const olderRefresh = deferred<Response>()
    const reconciliation = deferred<Response>()
    const signals: AbortSignal[] = []
    const fetchMock = mock((_url: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal)
      if (signals.length === 1) return Promise.resolve(jsonResponse({ value: 1 }))
      return signals.length === 2 ? olderRefresh.promise : reconciliation.promise
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { result } = renderHook(() => useHealthResource<{ value: number }>('/api/health'))
    await waitFor(() => expect(result.current.data).toEqual({ value: 1 }))

    act(() => { void result.current.refresh('explicit') })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    let reconciled!: Promise<{ value: number } | null>
    act(() => { reconciled = result.current.refresh('reconcile') })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(signals[1]?.aborted).toBe(true)

    await act(async () => { reconciliation.resolve(jsonResponse({ value: 3 })) })
    expect(await reconciled).toEqual({ value: 3 })
    expect(result.current.data).toEqual({ value: 3 })
  })

  it('turns a hung request into a retryable timeout instead of a permanent loading state', async () => {
    const signals: AbortSignal[] = []
    const request = mock()
      .mockImplementationOnce((_url: string, context: { signal: AbortSignal }) => {
        signals.push(context.signal)
        return new Promise<never>(() => {})
      })
      .mockResolvedValueOnce({ value: 2 })

    const { result } = renderHook(() => useHealthResource<{ value: number }>('/api/hung', {
      request,
      timeoutMs: (reason) => reason === 'initial' ? 10 : 50,
    }))

    await waitFor(() => expect(result.current.error).toBe('Request timed out after 10ms'))
    expect(signals[0]?.aborted).toBe(true)
    expect(result.current.loading).toBe(false)

    await act(async () => { await result.current.refresh() })
    expect(result.current.data).toEqual({ value: 2 })
    expect(result.current.error).toBeNull()
  })

  it('uses a safe default deadline and retains verified data when a refresh never settles', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const request = mock()
      .mockResolvedValueOnce({ value: 1 })
      .mockImplementationOnce((_url: string, context: { signal: AbortSignal }) => {
        signals.push(context.signal)
        return new Promise<never>(() => {})
      })

    const { result } = renderHook(() => useHealthResource<{ value: number }>('/api/hung', {
      request,
    }))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.data).toEqual({ value: 1 })

    act(() => { void result.current.refresh('background') })
    expect(result.current.refreshing).toBe(true)

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })

    expect(signals[0]?.aborted).toBe(true)
    expect(result.current.data).toEqual({ value: 1 })
    expect(result.current.error).toBeNull()
    expect(result.current.backgroundError).toBe('Request timed out after 15000ms')
    expect(result.current.stale).toBe(true)
    expect(result.current.loading).toBe(false)
    expect(result.current.refreshing).toBe(false)
  })
})
