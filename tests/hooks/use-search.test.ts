// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { act, renderHook, waitFor } from '@testing-library/react'
import '../rtl-settle'

// Mandatory mocks per CLAUDE.md test isolation rules — keep filesystem,
// logger, and watcher modules from ever resolving to the real ~/.bakin.
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => '/tmp/test-use-search',
  getBakinPaths: () => ({}),
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))
mock.module('@/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
}))

import { useSearch } from '@/hooks/use-search'
import { settleFor } from '../helpers/wait'

// --- fetch helpers --------------------------------------------------------

interface FetchCall {
  url: string
  init?: RequestInit
}

let fetchMock: ReturnType<typeof mock>
let fetchCalls: FetchCall[]

function mockFetchResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const ok = init.ok ?? true
  const status = init.status ?? 200
  fetchMock.mockImplementationOnce((url: string, reqInit?: RequestInit) => {
    fetchCalls.push({ url, init: reqInit })
    return Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(body),
    } as Response)
  })
}

function mockFetchAlways(body: unknown) {
  fetchMock.mockImplementation((url: string, reqInit?: RequestInit) => {
    fetchCalls.push({ url, init: reqInit })
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as Response)
  })
}

beforeEach(() => {
  fetchCalls = []
  fetchMock = mock()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  mock.restore()
})

// --- tests ----------------------------------------------------------------

describe('useSearch — debounce', () => {
  it('coalesces rapid search() calls into a single fetch', async () => {
    vi.useFakeTimers()
    mockFetchAlways({ results: [], aggregations: {} })

    const { result } = renderHook(() => useSearch({ debounce: 300 }))

    act(() => {
      result.current.search('a')
      result.current.search('ab')
      result.current.search('abc')
    })

    // Before the debounce fires no fetch should have happened.
    expect(fetchMock).not.toHaveBeenCalled()

    // Fire the timer.
    await act(async () => {
      vi.advanceTimersByTime(300)
      // Let the queued microtask resolve so the fetch promise chain runs.
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchCalls[0]?.url).toContain('q=abc')
  })
})

describe('useSearch — abort on unmount', () => {
  it('does not setState after unmount', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    let resolveFetch: ((res: Response) => void) | undefined
    fetchMock.mockImplementationOnce((url: string, reqInit?: RequestInit) => {
      fetchCalls.push({ url, init: reqInit })
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve
      })
    })

    const { result, unmount } = renderHook(() => useSearch({ debounce: 0 }))

    act(() => {
      result.current.search('x')
    })

    // Allow the 0ms debounce timer to fire so fetch is in flight. A real timer
    // window, not a condition: the point is that the debounce has ELAPSED.
    await act(async () => {
      await settleFor(5, 'let the 0ms search debounce timer fire so a fetch is in flight')
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Unmount before the fetch resolves.
    unmount()

    // Resolve fetch *after* unmount — the hook's mountedRef guard must
    // prevent any state updates and React must not log a warning about
    // updating state on an unmounted component.
    resolveFetch?.({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ results: [{ id: '1', table: 't', score: 1, fields: {} }] }),
    } as Response)

    await settleFor(10, 'a superseded response must NOT log an error — the absence of a log is the assertion')

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('useSearch — URL routing', () => {
  it('plugin-scoped option fetches /api/plugins/{plugin}/search', async () => {
    vi.useFakeTimers()
    mockFetchAlways({ results: [], aggregations: {} })

    const { result } = renderHook(() => useSearch({ plugin: 'tasks', debounce: 50 }))

    act(() => {
      result.current.search('foo')
    })

    await act(async () => {
      vi.advanceTimersByTime(50)
      await Promise.resolve()
    })

    expect(fetchCalls[0]?.url).toMatch(/^\/api\/plugins\/tasks\/search\?/)
    expect(fetchCalls[0]?.url).toContain('q=foo')
  })

  it('no plugin → fetches /api/search', async () => {
    vi.useFakeTimers()
    mockFetchAlways({ results: [], aggregations: {} })

    const { result } = renderHook(() => useSearch({ debounce: 50 }))

    act(() => {
      result.current.search('foo')
    })

    await act(async () => {
      vi.advanceTimersByTime(50)
      await Promise.resolve()
    })

    expect(fetchCalls[0]?.url).toMatch(/^\/api\/search\?/)
    expect(fetchCalls[0]?.url).toContain('q=foo')
  })

  it('passes facets through as comma-separated query param', async () => {
    vi.useFakeTimers()
    mockFetchAlways({ results: [], aggregations: {} })

    const { result } = renderHook(() =>
      useSearch({ plugin: 'tasks', facets: ['status', 'agent'], debounce: 50 }),
    )

    act(() => {
      result.current.search('q')
    })

    await act(async () => {
      vi.advanceTimersByTime(50)
      await Promise.resolve()
    })

    // URLSearchParams encodes the comma as %2C — accept either form.
    const url = fetchCalls[0]?.url ?? ''
    expect(url).toMatch(/facets=status(%2C|,)agent/)
  })
})

describe('useSearch — response handling', () => {
  it('surfaces aggregations from the response', async () => {
    // Use real timers — waitFor relies on real setTimeout internally and
    // hangs under fake timers.
    mockFetchResponse({
      results: [{ id: '1', table: 'bakin_tasks', score: 1, fields: {} }],
      aggregations: {
        status: [
          { value: 'open', count: 3 },
          { value: 'done', count: 5 },
        ],
      },
    })

    const { result } = renderHook(() => useSearch({ plugin: 'tasks', debounce: 10 }))

    act(() => {
      result.current.search('foo')
    })

    await waitFor(() => {
      expect(result.current.aggregations.status).toBeDefined()
    })
    expect(result.current.aggregations.status).toEqual([
      { value: 'open', count: 3 },
      { value: 'done', count: 5 },
    ])
    expect(result.current.results).toHaveLength(1)
  })

  it('a 200 with no results field yields an empty array, never undefined', async () => {
    // A malformed/mis-routed 200 body must not set results to undefined —
    // consumers do results.length and a single bad response would crash
    // every component using the hook (the kanban-dnd CI crash, #650).
    mockFetchResponse({ columns: { todo: [] } } as never)

    const { result } = renderHook(() => useSearch({ plugin: 'tasks', debounce: 10 }))

    act(() => {
      result.current.search('foo')
    })

    await waitFor(() => {
      expect(result.current.status).toBe('ok')
    })
    expect(result.current.results).toEqual([])
  })

  it('sets error state and clears results on a 500 response', async () => {
    mockFetchResponse({}, { ok: false, status: 500 })

    const { result } = renderHook(() => useSearch({ debounce: 10 }))

    act(() => {
      result.current.search('boom')
    })

    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })
    expect(result.current.error).toMatch(/500/)
    expect(result.current.results).toEqual([])
  })
})

describe('useSearch — clear()', () => {
  it('resets results, aggregations, error, meta, and loading state', async () => {
    mockFetchResponse({
      results: [{ id: '1', table: 'bakin_tasks', score: 1, fields: {} }],
      aggregations: { status: [{ value: 'open', count: 1 }] },
      meta: { query: 'foo', total: 1, took_ms: 5, source: 'search' },
    })

    const { result } = renderHook(() => useSearch({ plugin: 'tasks', debounce: 10 }))

    act(() => {
      result.current.search('foo')
    })

    await waitFor(() => {
      expect(result.current.results).toHaveLength(1)
    })

    act(() => {
      result.current.clear()
    })

    expect(result.current.results).toEqual([])
    expect(result.current.aggregations).toEqual({})
    expect(result.current.error).toBeNull()
    expect(result.current.meta).toBeNull()
    expect(result.current.loading).toBe(false)
  })
})

// --- honest status lifecycle (spec D11) ------------------------------------

describe('useSearch status states', () => {
  it('idle initially and after clear()', async () => {
    mockFetchAlways({ results: [], meta: { query: 'x', total: 0, took_ms: 1, source: 'search' } })
    const { result } = renderHook(() => useSearch({ debounce: 0 }))
    expect(result.current.status).toBe('idle')

    act(() => result.current.search('x'))
    await waitFor(() => expect(result.current.status).toBe('ok'))
    act(() => result.current.clear())
    expect(result.current.status).toBe('idle')
  })

  it('loading while the request is debounce-pending or in flight', async () => {
    mockFetchAlways({ results: [], meta: { query: 'x', total: 0, took_ms: 1, source: 'search' } })
    const { result } = renderHook(() => useSearch({ debounce: 50 }))
    act(() => result.current.search('x'))
    expect(result.current.status).toBe('loading')
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.status).toBe('ok'))
  })

  it('ok on a successful response', async () => {
    mockFetchResponse({
      results: [{ id: 'a', table: 'bakin_tasks', score: 1, fields: {} }],
      meta: { query: 'x', total: 1, took_ms: 2, source: 'search' },
    })
    const { result } = renderHook(() => useSearch({ debounce: 0 }))
    act(() => result.current.search('x'))
    await waitFor(() => expect(result.current.status).toBe('ok'))
    expect(result.current.results).toHaveLength(1)
  })

  it('unavailable on the explicit 503 contract, and retry() re-fetches', async () => {
    mockFetchResponse({ error: 'search_unavailable' }, { ok: false, status: 503 })
    const { result } = renderHook(() => useSearch({ debounce: 0 }))
    act(() => result.current.search('down'))
    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.results).toHaveLength(0)
    expect(result.current.error).toBeNull()

    // engine recovers → retry succeeds without re-typing the query
    mockFetchResponse({
      results: [{ id: 'a', table: 'bakin_tasks', score: 1, fields: {} }],
      meta: { query: 'down', total: 1, took_ms: 2, source: 'search' },
    })
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.status).toBe('ok'))
    expect(result.current.results).toHaveLength(1)
  })

  it('error on non-503 failures', async () => {
    mockFetchResponse({ error: 'boom' }, { ok: false, status: 500 })
    const { result } = renderHook(() => useSearch({ debounce: 0 }))
    act(() => result.current.search('x'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toContain('500')
  })

  it('types option rides the cross-plugin query string', async () => {
    mockFetchAlways({ results: [], meta: { query: 'x', total: 0, took_ms: 1, source: 'search' } })
    const { result } = renderHook(() => useSearch({ debounce: 0, types: ['assets', 'tasks'] }))
    act(() => result.current.search('x'))
    await waitFor(() => expect(result.current.status).toBe('ok'))
    expect(fetchCalls[fetchCalls.length - 1].url).toContain('types=assets%2Ctasks')
  })
})
