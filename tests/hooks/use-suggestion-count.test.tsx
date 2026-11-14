/** The sidebar's suggestion count (home-first-run plan, task 5.2): Home's state route is the one answer. */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { actRender } from '../rtl-settle'

const testDir = join(tmpdir(), `bakin-test-suggestion-count-${crypto.randomUUID()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { emitPluginEvent } from '@makinbakin/sdk/hooks'
import { useSuggestionCount } from '../../packages/host/src/hooks/use-suggestion-count'

let answer: { status: number; body: unknown } = { status: 200, body: { suggestions: Array.from({ length: 0 }, (_, i) => ({ id: `s${i}` })) } }
const asked: string[] = []
const realFetch = globalThis.fetch
beforeEach(() => {
  asked.length = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    asked.push(String(input))
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
})
afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
})

const mount = (pathname: string) => actRender(() => renderHook(({ at }: { at: string }) => useSuggestionCount(at), { initialProps: { at: pathname } }))

describe('useSuggestionCount', () => {
  it('is how many suggestions Home lists', async () => {
    answer = { status: 200, body: { suggestions: Array.from({ length: 4 }, (_, i) => ({ id: `s${i}` })) } }
    const hook = await mount('/tasks')
    await waitFor(() => expect(hook.result.current).toBe(4))
    expect(asked).toEqual(['/api/plugins/home/state'])
  })

  it('is zero when Home cannot answer, and when the answer is not a count', async () => {
    answer = { status: 500, body: { ok: false } }
    const failed = await mount('/tasks')
    await waitFor(() => expect(asked).toHaveLength(1))
    expect(failed.result.current).toBe(0)
    failed.unmount()
    answer = { status: 200, body: { suggestions: 'several' } }
    const odd = await mount('/tasks')
    await waitFor(() => expect(asked).toHaveLength(2))
    expect(odd.result.current).toBe(0)
  })

  it('looks again when the page changes, and keeps the last count while it does', async () => {
    answer = { status: 200, body: { suggestions: Array.from({ length: 3 }, (_, i) => ({ id: `s${i}` })) } }
    const hook = await mount('/explore')
    await waitFor(() => expect(hook.result.current).toBe(3))
    answer = { status: 200, body: { suggestions: Array.from({ length: 2 }, (_, i) => ({ id: `s${i}` })) } }
    await act(async () => { hook.rerender({ at: '/tasks' }) })
    await waitFor(() => expect(hook.result.current).toBe(2))
    expect(asked).toHaveLength(2)
    // The same page again asks nothing.
    await act(async () => { hook.rerender({ at: '/tasks' }) })
    expect(asked).toHaveLength(2)
  })

  it('looks again when a suggestion is put away in any browser', async () => {
    answer = { status: 200, body: { suggestions: Array.from({ length: 3 }, (_, i) => ({ id: `s${i}` })) } }
    const hook = await mount('/')
    await waitFor(() => expect(hook.result.current).toBe(3))
    answer = { status: 200, body: { suggestions: Array.from({ length: 2 }, (_, i) => ({ id: `s${i}` })) } }
    await act(async () => { emitPluginEvent({ event: 'home.suggestions_changed', id: 'web-search' }) })
    await waitFor(() => expect(hook.result.current).toBe(2))
  })
})
