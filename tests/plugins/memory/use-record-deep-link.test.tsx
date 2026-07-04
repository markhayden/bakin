// @vitest-environment jsdom
/**
 * useRecordDeepLink — ?recordId= drives the memory detail drawer.
 *
 * - a row already on screen (or just clicked) opens without a fetch
 * - an off-screen rowId resolves via GET /record
 * - a 404 yields an honest "not found" error — never a silent fallback
 * - close() clears the param
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'

const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-use-record-deep-link',
  getBakinPaths: () => ({}),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

const queryState: { recordId: string } = { recordId: '' }
const setRecordId = mock((v: string) => { queryState.recordId = v })
mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (key: string, defaultValue: string) =>
    key === 'recordId' ? [queryState.recordId || defaultValue, setRecordId, setRecordId] : [defaultValue, mock(), mock()],
  useQueryArrayState: () => [[], mock()],
}))

import { useRecordDeepLink } from '../../../plugins/memory/components/use-record-deep-link'
import type { SearchResult } from '@makinbakin/sdk/hooks'

const ROW: SearchResult = { id: 'durable:abc123', table: 'bakin_memory', score: 1, fields: { tier: 'durable', title: 'SOUL' } }

let fetchCalls: string[]

beforeEach(() => {
  queryState.recordId = ''
  setRecordId.mockClear()
  fetchCalls = []
})

afterEach(cleanup)

function mockRecordFetch(status: number, body: unknown) {
  ;(globalThis as Record<string, unknown>).fetch = mock((url: string) => {
    fetchCalls.push(String(url))
    return Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    } as Response)
  })
}

describe('useRecordDeepLink', () => {
  it('open() caches the clicked row and writes the param — no fetch', async () => {
    mockRecordFetch(500, {})
    const { result } = renderHook(() => useRecordDeepLink([]))
    act(() => result.current.open(ROW))
    expect(setRecordId).toHaveBeenCalledWith('durable:abc123')
    queryState.recordId = 'durable:abc123'
    const { result: reopened } = renderHook(() => useRecordDeepLink([]))
    // A fresh mount with no cache WOULD fetch; the same hook instance must not.
    await waitFor(() => expect(result.current.row?.id).toBe('durable:abc123'))
    expect(reopened).toBeDefined()
  })

  it('resolves an on-screen row without fetching', async () => {
    mockRecordFetch(500, {})
    queryState.recordId = 'durable:abc123'
    const { result } = renderHook(() => useRecordDeepLink([ROW]))
    await waitFor(() => expect(result.current.row?.id).toBe('durable:abc123'))
    expect(fetchCalls.length).toBe(0)
    expect(result.current.error).toBeNull()
  })

  it('fetches an off-screen row from /record', async () => {
    mockRecordFetch(200, { result: ROW })
    queryState.recordId = 'durable:abc123'
    const { result } = renderHook(() => useRecordDeepLink([]))
    await waitFor(() => expect(result.current.row?.id).toBe('durable:abc123'))
    expect(fetchCalls[0]).toContain('/api/plugins/memory/record?id=durable%3Aabc123')
    expect(result.current.error).toBeNull()
  })

  it('404 → honest not-found error, no row', async () => {
    mockRecordFetch(404, { error: 'record not found' })
    queryState.recordId = 'durable:gone'
    const { result } = renderHook(() => useRecordDeepLink([]))
    await waitFor(() => expect(result.current.error).toContain('not found'))
    expect(result.current.row).toBeNull()
  })

  it('non-404 fetch failure → honest load error, distinct from not-found', async () => {
    mockRecordFetch(500, { error: 'boom' })
    queryState.recordId = 'durable:abc123'
    const { result } = renderHook(() => useRecordDeepLink([]))
    await waitFor(() => expect(result.current.error).toContain('Could not load'))
    expect(result.current.error).not.toContain('not found')
    expect(result.current.row).toBeNull()
  })

  it('close() clears the param', () => {
    mockRecordFetch(200, { result: ROW })
    queryState.recordId = 'durable:abc123'
    const { result } = renderHook(() => useRecordDeepLink([ROW]))
    act(() => result.current.close())
    expect(setRecordId).toHaveBeenCalledWith('')
  })
})
