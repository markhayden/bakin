// @vitest-environment jsdom
/**
 * useRecordDeepLink — ?recordId= drives the memory detail drawer.
 *
 * - open() (explicit list click) caches the clicked row, pushes the param
 * - deep links ALWAYS resolve via GET /record — never from on-screen index
 *   copies (the &q= href fallback would silently reopen pruned records)
 * - a 404 yields an honest "not found" error — never a silent fallback
 * - close() clears the param
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { renderHook, waitFor, act } from '@testing-library/react'
import '../../rtl-settle'
import { actRender } from '../../rtl-settle'

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
// Distinct push-mode spy: opening a drawer must use the push variant so the
// back button closes it (third tuple element of useQueryState).
const pushRecordId = mock((v: string) => { queryState.recordId = v })
mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (key: string, defaultValue: string) =>
    key === 'recordId' ? [queryState.recordId || defaultValue, setRecordId, pushRecordId] : [defaultValue, mock(), mock()],
  useQueryArrayState: () => [[], mock()],
}))

import { useRecordDeepLink } from '../../../plugins/memory/components/use-record-deep-link'
import type { SearchResult } from '@makinbakin/sdk/hooks'

const ROW: SearchResult = { id: 'durable:abc123', table: 'bakin_memory', score: 1, fields: { tier: 'durable', title: 'SOUL' } }

let fetchCalls: string[]

beforeEach(() => {
  queryState.recordId = ''
  setRecordId.mockClear()
  pushRecordId.mockClear()
  fetchCalls = []
})


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
  it('open() caches the clicked row and PUSHES the param (history entry) — no fetch', async () => {
    mockRecordFetch(500, {})
    const { result } = await actRender(() => renderHook(() => useRecordDeepLink()))
    act(() => result.current.open(ROW))
    // Push variant, not replace — the back button must close the drawer.
    expect(pushRecordId).toHaveBeenCalledWith('durable:abc123')
    expect(setRecordId).not.toHaveBeenCalled()
    queryState.recordId = 'durable:abc123'
    const { result: reopened } = await actRender(() => renderHook(() => useRecordDeepLink()))
    // A fresh mount with no cache WOULD fetch; the same hook instance must not.
    await waitFor(() => expect(result.current.row?.id).toBe('durable:abc123'))
    expect(reopened).toBeDefined()
  })

  it('switching to another record clears the stale row while it resolves', async () => {
    const ROW_B: SearchResult = { id: 'durable:def456', table: 'bakin_memory', score: 1, fields: { tier: 'durable', title: 'TOOLS' } }
    // URL-aware mock: each record resolves to its own row.
    ;(globalThis as Record<string, unknown>).fetch = mock((url: string) => {
      fetchCalls.push(String(url))
      const row = String(url).includes(encodeURIComponent('durable:def456')) ? ROW_B : ROW
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ result: row }),
      } as Response)
    })
    queryState.recordId = 'durable:abc123'
    const { result, rerender } = await actRender(() => renderHook(() => useRecordDeepLink()))
    await waitFor(() => expect(result.current.row?.id).toBe('durable:abc123'))

    // Deep-link to record B — record A must not linger under ?recordId=B.
    queryState.recordId = 'durable:def456'
    act(() => rerender())
    expect(result.current.row).toBeNull()
    await waitFor(() => expect(result.current.row?.id).toBe('durable:def456'))
  })

  it('deep links ALWAYS resolve via /record — never from on-screen index copies', async () => {
    // The &q= fallback in hit hrefs populates the list with the row's stale
    // INDEX copy; short-circuiting on it would silently open a pruned
    // record and suppress the honest 404 notice.
    mockRecordFetch(404, { error: 'record not found' })
    queryState.recordId = 'durable:abc123'
    const { result } = await actRender(() => renderHook(() => useRecordDeepLink()))
    await waitFor(() => expect(result.current.error).toContain('not found'))
    expect(fetchCalls.length).toBe(1)
    expect(result.current.row).toBeNull()
  })

  it('fetches an off-screen row from /record', async () => {
    mockRecordFetch(200, { result: ROW })
    queryState.recordId = 'durable:abc123'
    const { result } = await actRender(() => renderHook(() => useRecordDeepLink()))
    await waitFor(() => expect(result.current.row?.id).toBe('durable:abc123'))
    expect(fetchCalls[0]).toContain('/api/plugins/memory/record?id=durable%3Aabc123')
    expect(result.current.error).toBeNull()
  })

  it('404 → honest not-found error, no row', async () => {
    mockRecordFetch(404, { error: 'record not found' })
    queryState.recordId = 'durable:gone'
    const { result } = await actRender(() => renderHook(() => useRecordDeepLink()))
    await waitFor(() => expect(result.current.error).toContain('not found'))
    expect(result.current.row).toBeNull()
  })

  it('non-404 fetch failure → honest load error, distinct from not-found', async () => {
    mockRecordFetch(500, { error: 'boom' })
    queryState.recordId = 'durable:abc123'
    const { result } = await actRender(() => renderHook(() => useRecordDeepLink()))
    await waitFor(() => expect(result.current.error).toContain('Could not load'))
    expect(result.current.error).not.toContain('not found')
    expect(result.current.row).toBeNull()
  })

  it('close() clears the param', async () => {
    mockRecordFetch(200, { result: ROW })
    queryState.recordId = 'durable:abc123'
    const { result } = await actRender(() => renderHook(() => useRecordDeepLink()))
    act(() => result.current.close())
    expect(setRecordId).toHaveBeenCalledWith('')
  })
})
