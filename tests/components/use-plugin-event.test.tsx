import { describe, it, expect, mock } from 'bun:test'
import { renderHook } from '@testing-library/react'
import '../rtl-settle'
import { usePluginEvent, emitPluginEvent } from '@/hooks/use-plugin-event'

describe('usePluginEvent', () => {
  it('delivers matching events to the subscriber with the full payload', () => {
    const handler = mock()
    renderHook(() => usePluginEvent('asset.changed', handler))

    emitPluginEvent({ event: 'asset.changed', assetId: 'a1' })
    emitPluginEvent({ event: 'asset.removed', assetId: 'a2' }) // different event — ignored

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ event: 'asset.changed', assetId: 'a1' })
  })

  it('stops delivering after unmount (unsubscribes)', () => {
    const handler = mock()
    const { unmount } = renderHook(() => usePluginEvent('asset.changed', handler))
    emitPluginEvent({ event: 'asset.changed' })
    expect(handler).toHaveBeenCalledTimes(1)
    unmount()
    emitPluginEvent({ event: 'asset.changed' })
    expect(handler).toHaveBeenCalledTimes(1) // no further calls
  })

  it('always calls the latest handler (no stale closure)', () => {
    let calls = 0
    const { rerender } = renderHook(
      ({ n }: { n: number }) => usePluginEvent('x', () => { calls += n }),
      { initialProps: { n: 1 } },
    )
    rerender({ n: 10 })
    emitPluginEvent({ event: 'x' })
    expect(calls).toBe(10)
  })

  it('a throwing subscriber does not break the others', () => {
    const bad = mock(() => { throw new Error('boom') })
    const good = mock()
    renderHook(() => usePluginEvent('y', bad))
    renderHook(() => usePluginEvent('y', good))
    expect(() => emitPluginEvent({ event: 'y' })).not.toThrow()
    expect(good).toHaveBeenCalledTimes(1)
  })

  it('ignores payloads without a string event', () => {
    const handler = mock()
    renderHook(() => usePluginEvent('asset.changed', handler))
    emitPluginEvent({ assetId: 'no-event-field' } as never)
    expect(handler).not.toHaveBeenCalled()
  })
})
