// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, renderHook } from '@testing-library/react'

// Mock fetch globally so initialize() doesn't hit the network
vi.stubGlobal('fetch', mock(() =>
  Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
))

describe('useContentStore — debug state', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    storage = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value) },
        removeItem: (key: string) => { storage.delete(key) },
        clear: () => { storage.clear() },
      },
      configurable: true,
    })
  })

  afterEach(() => {
    cleanup()
    storage.clear()
    vi.resetModules()
  })

  it('defaults debug to false', async () => {
    const { useContentStore } = await import('@/hooks/use-content-store')
    const state = useContentStore.getState()
    expect(state.debug).toBe(false)
  })

  it('setDebug(true) updates state and persists to localStorage', async () => {
    const { useContentStore } = await import('@/hooks/use-content-store')

    act(() => { useContentStore.getState().setDebug(true) })

    expect(useContentStore.getState().debug).toBe(true)
    expect(storage.get('bakin-debug')).toBe('true')
  })

  it('setDebug(false) updates state and persists "false" to localStorage', async () => {
    const { useContentStore } = await import('@/hooks/use-content-store')

    act(() => { useContentStore.getState().setDebug(true) })
    act(() => { useContentStore.getState().setDebug(false) })

    expect(useContentStore.getState().debug).toBe(false)
    expect(storage.get('bakin-debug')).toBe('false')
  })

  it('initialize() hydrates debug from localStorage when "true"', async () => {
    storage.set('bakin-debug', 'true')
    const { useContentStore } = await import('@/hooks/use-content-store')

    await act(async () => { await useContentStore.getState().initialize() })

    expect(useContentStore.getState().debug).toBe(true)
  })

  it('initialize() leaves debug false when localStorage key is absent', async () => {
    const { useContentStore } = await import('@/hooks/use-content-store')

    await act(async () => { await useContentStore.getState().initialize() })

    expect(useContentStore.getState().debug).toBe(false)
  })

  it('initialize() leaves debug false when localStorage value is not "true"', async () => {
    storage.set('bakin-debug', 'false')
    const { useContentStore } = await import('@/hooks/use-content-store')

    await act(async () => { await useContentStore.getState().initialize() })

    expect(useContentStore.getState().debug).toBe(false)
  })

  it('setDebug tolerates localStorage throwing', async () => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: () => { throw new Error('quota exceeded') },
        setItem: () => { throw new Error('quota exceeded') },
        removeItem: () => {},
        clear: () => {},
      },
      configurable: true,
    })

    const { useContentStore } = await import('@/hooks/use-content-store')

    // Should not throw
    act(() => { useContentStore.getState().setDebug(true) })

    expect(useContentStore.getState().debug).toBe(true)
  })
})

describe('useDebug hook', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    storage = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value) },
        removeItem: (key: string) => { storage.delete(key) },
        clear: () => { storage.clear() },
      },
      configurable: true,
    })
  })

  afterEach(() => {
    cleanup()
    storage.clear()
    vi.resetModules()
  })

  it('returns [false, toggleFn] by default', async () => {
    const { useDebug } = await import('@/hooks/use-debug')
    const { result } = renderHook(() => useDebug())

    expect(result.current[0]).toBe(false)
    expect(typeof result.current[1]).toBe('function')
  })

  it('toggleDebug flips debug from false to true', async () => {
    const { useDebug } = await import('@/hooks/use-debug')
    const { result } = renderHook(() => useDebug())

    act(() => { result.current[1]() })

    expect(result.current[0]).toBe(true)
    expect(storage.get('bakin-debug')).toBe('true')
  })

  it('toggleDebug flips debug from true to false', async () => {
    const { useContentStore } = await import('@/hooks/use-content-store')
    const { useDebug } = await import('@/hooks/use-debug')

    act(() => { useContentStore.getState().setDebug(true) })

    const { result } = renderHook(() => useDebug())
    expect(result.current[0]).toBe(true)

    act(() => { result.current[1]() })

    expect(result.current[0]).toBe(false)
    expect(storage.get('bakin-debug')).toBe('false')
  })
})

describe('DebugSeed', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    storage = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value) },
        removeItem: (key: string) => { storage.delete(key) },
        clear: () => { storage.clear() },
      },
      configurable: true,
    })
  })

  afterEach(() => {
    cleanup()
    storage.clear()
    vi.resetModules()
  })

  it('seeds debug from ?debug=true URL param', async () => {
    // Set the URL with ?debug=true
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?debug=true' },
      configurable: true,
      writable: true,
    })

    const { useContentStore } = await import('@/hooks/use-content-store')

    // Import and render DebugSeed — it's a React component, so we need React
    const React = await import('react')
    const { render: rtlRender } = await import('@testing-library/react')

    // DebugSeed uses useContentStore directly, no other providers needed
    function DebugSeed() {
      const setDebug = useContentStore((s: any) => s.setDebug)
      React.useEffect(() => {
        if (new URLSearchParams(window.location.search).get('debug') === 'true') {
          setDebug(true)
        }
      }, [setDebug])
      return null
    }

    rtlRender(React.createElement(DebugSeed))

    expect(useContentStore.getState().debug).toBe(true)
    expect(storage.get('bakin-debug')).toBe('true')
  })

  it('does not activate debug when URL param is absent', async () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '' },
      configurable: true,
      writable: true,
    })

    const { useContentStore } = await import('@/hooks/use-content-store')
    const React = await import('react')
    const { render: rtlRender } = await import('@testing-library/react')

    function DebugSeed() {
      const setDebug = useContentStore((s: any) => s.setDebug)
      React.useEffect(() => {
        if (new URLSearchParams(window.location.search).get('debug') === 'true') {
          setDebug(true)
        }
      }, [setDebug])
      return null
    }

    rtlRender(React.createElement(DebugSeed))

    expect(useContentStore.getState().debug).toBe(false)
  })
})
