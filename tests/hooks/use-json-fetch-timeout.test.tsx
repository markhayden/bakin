// @vitest-environment jsdom

/**
 * Deadline lifecycle for `useJsonFetch`.
 *
 * The case that matters: `fetch` resolves at HEADERS, not body. A request whose
 * headers beat the deadline but whose body settles after it used to leave the
 * hook stuck at `loading: true` forever with no data and no error — the exact
 * hang the deadline exists to prevent, reachable only by callers who opted in.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import '../rtl-settle'

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { useJsonFetch } from '../../src/hooks/use-json-fetch'

const originalFetch = globalThis.fetch

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe('useJsonFetch deadlines', () => {
  it('reports a timeout when the body settles after the deadline', async () => {
    // Headers arrive immediately; the body is still pending when the deadline
    // fires. `res.json()` resolving afterwards must not strand the hook.
    const body = deferred<unknown>()
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: () => body.promise,
    })) as unknown as typeof fetch

    const { result } = renderHook(() => useJsonFetch<{ ok: boolean }>('/slow', { timeoutMs: 20 }))

    await waitFor(() => expect(result.current.error).toBe('Request timed out'), { timeout: 2000 })
    expect(result.current.loading).toBe(false)

    // The late body must not overwrite the honest timeout with a success.
    await act(async () => { body.resolve({ ok: true }) })
    expect(result.current.error).toBe('Request timed out')
    expect(result.current.data).toBeNull()
  })

  it('resolves normally when the whole response beats the deadline', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })) as unknown as typeof fetch

    const { result } = renderHook(() => useJsonFetch<{ ok: boolean }>('/fast', { timeoutMs: 5000 }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ ok: true })
    expect(result.current.error).toBeNull()
  })

  it('leaves callers without a deadline unchanged', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })) as unknown as typeof fetch

    const { result } = renderHook(() => useJsonFetch<{ ok: boolean }>('/plain'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ ok: true })
    expect(result.current.error).toBeNull()
  })
})
