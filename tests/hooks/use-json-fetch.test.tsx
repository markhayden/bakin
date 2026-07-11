// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock, beforeEach } from 'bun:test'
import { renderHook, waitFor, act } from '@testing-library/react'
import '../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure hook test — no storage access. Defensive content-dir mocks per convention.
const testDir = join(tmpdir(), 'bakin-test-use-json-fetch')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { useJsonFetch } from '../../src/hooks/use-json-fetch'

const originalFetch = globalThis.fetch

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const m = mock(impl)
  globalThis.fetch = m as unknown as typeof fetch
  return m
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

beforeEach(() => {
  globalThis.fetch = originalFetch
})

describe('useJsonFetch', () => {
  it('loads JSON and clears loading', async () => {
    mockFetch(async () => new Response(JSON.stringify({ value: 42 }), { status: 200 }))
    const { result } = renderHook(() => useJsonFetch<{ value: number }>('/api/thing'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ value: 42 })
    expect(result.current.error).toBeNull()
  })

  it('skips fetching when url is null', async () => {
    const f = mockFetch(async () => new Response('{}', { status: 200 }))
    const { result } = renderHook(() => useJsonFetch(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('reports an error on a non-2xx response', async () => {
    mockFetch(async () => new Response('nope', { status: 404 }))
    const { result } = renderHook(() => useJsonFetch('/api/missing'))
    await waitFor(() => expect(result.current.error).toBe('Request failed (404)'))
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('reports an error on a network failure', async () => {
    mockFetch(async () => { throw new Error('offline') })
    const { result } = renderHook(() => useJsonFetch('/api/thing'))
    await waitFor(() => expect(result.current.error).toBe('offline'))
  })

  it('refresh() re-runs the fetch', async () => {
    let n = 0
    const f = mockFetch(async () => new Response(JSON.stringify({ n: ++n }), { status: 200 }))
    const { result } = renderHook(() => useJsonFetch<{ n: number }>('/api/counter'))
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }))
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }))
    expect(f).toHaveBeenCalledTimes(2)
  })
})
