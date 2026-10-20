/**
 * useNow (#966): a render-safe clock — the instant at mount, refreshed on
 * its interval, stopped on unmount. Timers are observed through spies so
 * every state update lands inside act.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import { useNow } from '@makinbakin/sdk/hooks'
import { actRender } from '../../rtl-settle'

const intervals: Array<{ fn: () => void; ms: number; id: number }> = []
const cleared: number[] = []
const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval
beforeEach(() => {
  intervals.length = 0
  cleared.length = 0
  globalThis.setInterval = ((fn: () => void, ms: number) => {
    const id = intervals.length + 1
    intervals.push({ fn, ms, id })
    return id
  }) as unknown as typeof setInterval
  globalThis.clearInterval = ((id: number) => { cleared.push(id) }) as unknown as typeof clearInterval
})
afterEach(() => {
  globalThis.setInterval = realSetInterval
  globalThis.clearInterval = realClearInterval
})

describe('useNow', () => {
  it('starts at the mount instant, advances on each tick of its interval, and clears it on unmount', async () => {
    const before = Date.now()
    const { result, unmount } = await actRender(() => renderHook(() => useNow(20)))
    const first = result.current
    expect(first.getTime()).toBeGreaterThanOrEqual(before)
    expect(intervals).toHaveLength(1)
    expect(intervals[0]!.ms).toBe(20)
    await act(async () => { intervals[0]!.fn() })
    expect(result.current).not.toBe(first)
    expect(result.current.getTime()).toBeGreaterThanOrEqual(first.getTime())
    await act(async () => { unmount() })
    expect(cleared).toEqual([intervals[0]!.id])
  })

  it('a non-positive interval installs no timer: a fixed mount instant', async () => {
    const { result, rerender, unmount } = await actRender(() => renderHook(() => useNow(0)))
    const first = result.current
    await act(async () => { rerender() })
    expect(result.current).toBe(first)
    expect(intervals).toHaveLength(0)
    await act(async () => { unmount() })
  })
})
