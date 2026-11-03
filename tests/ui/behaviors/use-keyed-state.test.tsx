/**
 * useKeyedState (#966b): state that resets to its initializer when the key
 * changes, in the same render as the key — never a frame late.
 */
import { describe, expect, it } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import { useKeyedState } from '@makinbakin/sdk/hooks'
import { actRender } from '../../rtl-settle'

describe('useKeyedState', () => {
  it('keeps edits while the key holds and resets to the initializer when it changes', async () => {
    let inits = 0
    const { result, rerender, unmount } = await actRender(() =>
      renderHook(({ id }: { id: string }) => useKeyedState(id, () => { inits += 1; return `draft for ${id}` }), { initialProps: { id: 'a' } }))
    expect(result.current[0]).toBe('draft for a')
    await act(async () => { result.current[1]('edited a') })
    expect(result.current[0]).toBe('edited a')
    await act(async () => { rerender({ id: 'a' }) })
    expect(result.current[0]).toBe('edited a')
    await act(async () => { rerender({ id: 'b' }) })
    expect(result.current[0]).toBe('draft for b')
    expect(inits).toBe(2)
    await act(async () => { result.current[1]((prev) => `${prev}!`) })
    expect(result.current[0]).toBe('draft for b!')
    await act(async () => { unmount() })
  })

  it('an update to the same value bails out like useState (no re-render)', async () => {
    let renders = 0
    const { result, unmount } = await actRender(() => renderHook(() => { renders += 1; return useKeyedState('k', () => 'same') }))
    const after = renders
    await act(async () => { result.current[1]('same') })
    await act(async () => { result.current[1]((prev) => prev) })
    expect(renders).toBe(after)
    await act(async () => { result.current[1]('changed') })
    expect(renders).toBe(after + 1)
    await act(async () => { unmount() })
  })
})
