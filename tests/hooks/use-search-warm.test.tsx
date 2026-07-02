// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cleanup, renderHook, waitFor } from '@testing-library/react'

// Pure client hook (fetch only), but pin the resolvers per the repo-wide
// test-isolation rules so nothing transitive can reach ~/.bakin.
const isolationDir = join(tmpdir(), `bakin-test-use-search-warm-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => isolationDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => isolationDir,
}))

import { useSearchWarm } from '@/hooks/use-search-warm'

let fetchMock: ReturnType<typeof mock>
let warmResponse: string
const realFetch = globalThis.fetch

beforeEach(() => {
  warmResponse = 'warming'
  fetchMock = mock(() =>
    Promise.resolve({
      json: () => Promise.resolve({ warm: warmResponse }),
    } as Response),
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
  mock.restore()
})

describe('useSearchWarm', () => {
  it('reports the boot warm state and keeps polling until warm', async () => {
    const { result } = renderHook(() => useSearchWarm())

    await waitFor(() => expect(result.current).toBe('warming'))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/search/warm')

    warmResponse = 'warm'
    await waitFor(() => expect(result.current).toBe('warm'), { timeout: 5000 })
  })

  it('fails open to warm on a fetch error — the indicator never blocks search', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('server restarting')))

    const { result } = renderHook(() => useSearchWarm())

    await waitFor(() => expect(result.current).toBe('warm'))
  })
})
