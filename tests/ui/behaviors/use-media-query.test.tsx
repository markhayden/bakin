/**
 * useMediaQuery (#966b): the breakpoint as an external store — the current
 * match at mount, re-read on the list's change event, false without
 * matchMedia.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import { useMediaQuery } from '@makinbakin/sdk/hooks'
import { actRender } from '../../rtl-settle'

const originalMatchMedia = window.matchMedia
afterEach(() => { Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia }) })

describe('useMediaQuery', () => {
  it('reads the match at mount and follows change events', async () => {
    let matches = false
    const listeners = new Set<() => void>()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ get matches() { return matches }, addEventListener: (_: string, cb: () => void) => { listeners.add(cb) }, removeEventListener: (_: string, cb: () => void) => { listeners.delete(cb) } }),
    })
    const { result, unmount } = await actRender(() => renderHook(() => useMediaQuery('(min-width: 768px)')))
    expect(result.current).toBe(false)
    expect(listeners.size).toBe(1)
    matches = true
    await act(async () => { for (const cb of listeners) cb() })
    expect(result.current).toBe(true)
    await act(async () => { unmount() })
    expect(listeners.size).toBe(0)
  })

  it('is false where matchMedia does not exist', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined })
    const { result, unmount } = await actRender(() => renderHook(() => useMediaQuery('(min-width: 768px)')))
    expect(result.current).toBe(false)
    await act(async () => { unmount() })
  })
})
