// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, renderHook } from '@testing-library/react'
import { actRender } from '../rtl-settle'
import { useContentStore } from '../../packages/sdk/src/hooks/use-content-store'
import { useFullscreen } from '../../packages/sdk/src/hooks/use-fullscreen'

type FullscreenDocument = { fullscreenEnabled: boolean; fullscreenElement: Element | null; exitFullscreen(): Promise<void> }

function browser(enabled: boolean) {
  const requested = mock(async () => undefined)
  const exited = mock(async () => undefined)
  const doc = document as unknown as FullscreenDocument
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: enabled })
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, writable: true, value: null })
  document.documentElement.requestFullscreen = requested as unknown as Element['requestFullscreen']
  doc.exitFullscreen = exited
  return { requested, exited, doc }
}

afterEach(() => {
  cleanup()
  useContentStore.setState({ fullscreen: null })
})

describe('useFullscreen (host full screen for a page that is the point of the visit)', () => {
  it('enter holds full screen for this page and asks the browser (inside the click); exit releases both', async () => {
    const { requested, exited, doc } = browser(true)
    const view = await actRender(() => renderHook(() => useFullscreen()))
    expect(view.result.current.active).toBe(false)
    expect(view.result.current.browser).toBe(true)
    await act(async () => { view.result.current.enter() })
    expect(view.result.current.active).toBe(true)
    expect(useContentStore.getState().fullscreen).toBe(window.location.pathname)
    expect(requested).toHaveBeenCalledTimes(1)
    doc.fullscreenElement = document.documentElement
    await act(async () => { view.result.current.toggle() })
    expect(view.result.current.active).toBe(false)
    expect(exited).toHaveBeenCalledTimes(1)
  })
  it('where the browser cannot go full screen (an iPhone), the host still hides its chrome', async () => {
    const { requested } = browser(false)
    const view = await actRender(() => renderHook(() => useFullscreen()))
    expect(view.result.current.browser).toBe(false)
    await act(async () => { view.result.current.enter() })
    expect(view.result.current.active).toBe(true)
    expect(requested).not.toHaveBeenCalled()
  })
  it('an exit while the browser is still granting full screen wins: the late grant is undone, Esc never locked', async () => {
    const { exited, doc } = browser(true)
    let grant = () => {}
    document.documentElement.requestFullscreen = (() => new Promise<void>((resolve) => { grant = () => { doc.fullscreenElement = document.documentElement; resolve() } })) as unknown as Element['requestFullscreen']
    const locked = mock(async () => undefined)
    Object.defineProperty(navigator, 'keyboard', { configurable: true, value: { lock: locked, unlock: () => {} } })
    const view = await actRender(() => renderHook(() => useFullscreen()))
    await act(async () => { view.result.current.enter() })
    await act(async () => { view.result.current.exit() })
    await act(async () => { grant() })
    expect(view.result.current.active).toBe(false)
    expect(exited).toHaveBeenCalledTimes(1)
    expect(locked).not.toHaveBeenCalled()
  })
  it('enter, exit, enter again while the first grant is pending: the stale grant never cancels the newer owner (either order)', async () => {
    for (const order of ['stale-first', 'stale-last'] as const) {
      const { exited, doc } = browser(true)
      const grants: Array<() => void> = []
      document.documentElement.requestFullscreen = (() => new Promise<void>((resolve) => { grants.push(() => { doc.fullscreenElement = document.documentElement; resolve() }) })) as unknown as Element['requestFullscreen']
      const locked = mock(async () => undefined)
      Object.defineProperty(navigator, 'keyboard', { configurable: true, value: { lock: locked, unlock: () => {} } })
      const view = await actRender(() => renderHook(() => useFullscreen()))
      await act(async () => { view.result.current.enter() })
      await act(async () => { view.result.current.exit() })
      await act(async () => { view.result.current.enter() })
      const [stale, current] = [grants[0]!, grants[1]!]
      if (order === 'stale-first') { await act(async () => { stale() }); await act(async () => { current() }) } else { await act(async () => { current() }); await act(async () => { stale() }) }
      expect(view.result.current.active).toBe(true)
      expect(exited).not.toHaveBeenCalled()
      expect(locked).toHaveBeenCalledTimes(1)
      cleanup()
      useContentStore.setState({ fullscreen: null })
    }
  })
})
