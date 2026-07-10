// @vitest-environment jsdom
/**
 * useTaskRunHistory lifecycle (#482 minors): switching taskId must not show
 * the previous task's runs while the new fetch is in flight, and the stale
 * request is aborted so a late response can never clobber the new task's data.
 * The hook is on the public SDK surface (@makinbakin/sdk/hooks), so this is
 * pinned even though the drawer remounts per task today.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import '../rtl-settle'

const testDir = join(tmpdir(), `bakin-test-use-task-run-history-${Date.now()}`)

// The hook only talks to fetch, but close the isolation surface anyway.
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

type PendingFetch = { url: string; signal: AbortSignal | undefined; resolve: (v: unknown) => void }
let pending: PendingFetch[] = []
const fetchMock = mock((url: string | URL, init?: RequestInit) =>
  new Promise((resolve) => {
    pending.push({ url: String(url), signal: init?.signal ?? undefined, resolve })
  }),
)
globalThis.fetch = fetchMock as unknown as typeof fetch

const { useTaskRunHistory } = await import('../../src/hooks/use-task-run-history')

const RUN = {
  runId: 'task:t1:d1', taskId: 't1', seq: 1, agent: 'pixel',
  status: 'settled', startedAt: '2026-06-08T12:00:00.000Z',
}

function jsonResponse(data: unknown) {
  return { ok: true, json: async () => data }
}

beforeEach(() => {
  cleanup()
  pending = []
  fetchMock.mockClear()
})

afterAll(() => cleanup())

describe('useTaskRunHistory', () => {
  it('resets stale runs and outcome immediately when taskId changes', async () => {
    const { result, rerender } = renderHook(({ id }: { id: string }) => useTaskRunHistory(id), {
      initialProps: { id: 't1' },
    })
    pending.shift()!.resolve(jsonResponse({ runs: [RUN], outcome: { state: 'done' } }))
    await waitFor(() => expect(result.current.runs).toHaveLength(1))
    expect(result.current.outcome?.state).toBe('done')

    rerender({ id: 't2' })
    // t2's fetch is still in flight — t1's data must already be gone
    expect(result.current.runs).toEqual([])
    expect(result.current.outcome).toBeUndefined()
  })

  it('aborts the in-flight request when taskId changes or the consumer unmounts', async () => {
    const { rerender, unmount } = renderHook(({ id }: { id: string }) => useTaskRunHistory(id), {
      initialProps: { id: 't1' },
    })
    const first = pending[0]!
    expect(first.signal).toBeDefined()

    rerender({ id: 't2' })
    expect(first.signal!.aborted).toBe(true)

    const second = pending[1]!
    unmount()
    expect(second.signal!.aborted).toBe(true)
  })
})
