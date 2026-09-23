// @vitest-environment jsdom
/**
 * The shared model-options hook (#907, T3.10): no cross-mount cache — a
 * fresh mount always reads the catalog — and a `models.catalog_changed`
 * plugin event refetches, so a picker never keeps offering a model the
 * server now knows is dead.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-use-available-models-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { act, renderHook, waitFor } from '@testing-library/react'
import '../rtl-settle'
import { actRender } from '../rtl-settle'
import { useAvailableModels } from '../../src/hooks/use-available-models'
import { emitPluginEvent } from '../../src/hooks/use-plugin-event'

let catalog: Array<{ id: string; name: string; provider: string; tier: string }> = []
let fetches = 0
const originalFetch = globalThis.fetch

beforeEach(() => {
  fetches = 0
  catalog = [{ id: 'a/one', name: 'One', provider: 'a', tier: 'budget' }]
  globalThis.fetch = mock(async () => {
    fetches += 1
    return new Response(JSON.stringify({ models: catalog }), { headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
})
afterEach(() => { globalThis.fetch = originalFetch })

describe('useAvailableModels', () => {
  it('reads the catalog on mount and again on models.catalog_changed', async () => {
    const { result } = await actRender(() => renderHook(() => useAvailableModels()))
    await waitFor(() => expect(result.current.map((m) => m.id)).toEqual(['a/one']))
    expect(fetches).toBe(1)
    catalog = [{ id: 'a/two', name: 'Two', provider: 'a', tier: 'budget' }]
    await act(async () => { emitPluginEvent({ event: 'models.catalog_changed', reason: 'refresh' }) })
    await waitFor(() => expect(result.current.map((m) => m.id)).toEqual(['a/two']))
    expect(fetches).toBe(2)
  })

  it('a catalog_changed event during an in-flight read fetches AGAIN — the refetch never resolves to the pre-change rows', async () => {
    // Save on the Models page while a Team picker is still loading: the
    // single-flight dedupe must not hand the event-driven refetch the stale
    // request's answer.
    let release: (() => void) | null = null
    let calls = 0
    globalThis.fetch = mock(async () => {
      calls += 1
      if (calls === 1) await new Promise<void>((resolve) => { release = resolve })
      return new Response(JSON.stringify({ models: catalog }), { headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    const { result } = await actRender(() => renderHook(() => useAvailableModels()))
    await waitFor(() => expect(calls).toBe(1))
    catalog = [{ id: 'a/two', name: 'Two', provider: 'a', tier: 'budget' }]
    await act(async () => { emitPluginEvent({ event: 'models.catalog_changed', reason: 'selections' }) })
    await act(async () => { release?.() })
    await waitFor(() => expect(result.current.map((m) => m.id)).toEqual(['a/two']))
    expect(calls).toBe(2)
  })

  it('a fresh mount never reuses an earlier mount\'s rows', async () => {
    const first = await actRender(() => renderHook(() => useAvailableModels()))
    await waitFor(() => expect(first.result.current).toHaveLength(1))
    first.unmount()
    catalog = []
    const second = await actRender(() => renderHook(() => useAvailableModels()))
    await waitFor(() => expect(fetches).toBe(2))
    await waitFor(() => expect(second.result.current).toEqual([]))
  })
})
