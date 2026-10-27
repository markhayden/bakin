// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import '../rtl-settle'

type HostStoreModule = typeof import('../../packages/sdk/src/hooks/use-host-store')

const STORE_PATH = '../../packages/sdk/src/hooks/use-host-store'
let fresh = 0

/** A genuinely new store: a cache-busted module import runs creation again. */
async function freshStore(): Promise<HostStoreModule['useHostStore']> {
  const mod = (await import(`${STORE_PATH}.ts?case=${++fresh}`)) as HostStoreModule
  return mod.useHostStore
}

/** The shared singleton every hook in the SDK uses. */
function sharedStore(): HostStoreModule['useHostStore'] {
  return (require(STORE_PATH) as HostStoreModule).useHostStore
}

function installStorage(storage: Map<string, string>): void {
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
      clear: () => { storage.clear() },
    },
    configurable: true,
  })
}

let storage: Map<string, string>

beforeEach(() => {
  storage = new Map<string, string>()
  installStorage(storage)
  vi.stubGlobal('fetch', mock(async () => Response.json({ events: [] })))
  act(() => { sharedStore().setState({ debug: false }, false) })
})

afterEach(() => {
  storage.clear()
  vi.unstubAllGlobals()
})

describe('useHostStore — debug hydration at creation', () => {
  it('hydrates true from localStorage', async () => {
    storage.set('bakin-debug', 'true')
    expect((await freshStore()).getState().debug).toBe(true)
  })

  it('hydrates false when the key is absent or not "true"', async () => {
    expect((await freshStore()).getState().debug).toBe(false)
    storage.set('bakin-debug', 'false')
    expect((await freshStore()).getState().debug).toBe(false)
  })

  it('falls back to false when getItem throws', async () => {
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: () => { throw new Error('denied') }, setItem: () => {}, removeItem: () => {}, clear: () => {} },
      configurable: true,
    })
    expect((await freshStore()).getState().debug).toBe(false)
  })

  it('falls back to false when the localStorage getter itself throws', async () => {
    Object.defineProperty(window, 'localStorage', { get: () => { throw new Error('SecurityError') }, configurable: true })
    expect((await freshStore()).getState().debug).toBe(false)
  })

  it('falls back to false when localStorage is absent', async () => {
    Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true })
    const saved = (globalThis as { localStorage?: unknown }).localStorage
    delete (globalThis as { localStorage?: unknown }).localStorage
    try {
      expect((await freshStore()).getState().debug).toBe(false)
    } finally {
      ;(globalThis as { localStorage?: unknown }).localStorage = saved
    }
  })
})

describe('useHostStore — debug writes', () => {
  it('setDebug persists true and false', () => {
    const store = sharedStore()
    act(() => { store.getState().setDebug(true) })
    expect(store.getState().debug).toBe(true)
    expect(storage.get('bakin-debug')).toBe('true')
    act(() => { store.getState().setDebug(false) })
    expect(store.getState().debug).toBe(false)
    expect(storage.get('bakin-debug')).toBe('false')
  })

  it('setDebug tolerates localStorage throwing', () => {
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: () => null, setItem: () => { throw new Error('quota exceeded') }, removeItem: () => {}, clear: () => {} },
      configurable: true,
    })
    const store = sharedStore()
    act(() => { store.getState().setDebug(true) })
    expect(store.getState().debug).toBe(true)
  })
})

describe('useDebug hook', () => {
  it('returns [false, toggleFn] by default', () => {
    const { useDebug } = require('../../packages/sdk/src/hooks/use-debug') as typeof import('../../packages/sdk/src/hooks/use-debug')
    const { result } = renderHook(() => useDebug())
    expect(result.current[0]).toBe(false)
    expect(typeof result.current[1]).toBe('function')
  })

  it('toggles both ways and persists', () => {
    const { useDebug } = require('../../packages/sdk/src/hooks/use-debug') as typeof import('../../packages/sdk/src/hooks/use-debug')
    const { result } = renderHook(() => useDebug())
    act(() => { result.current[1]() })
    expect(result.current[0]).toBe(true)
    expect(storage.get('bakin-debug')).toBe('true')
    act(() => { result.current[1]() })
    expect(result.current[0]).toBe(false)
    expect(storage.get('bakin-debug')).toBe('false')
  })
})

describe('DebugSeed (?debug=true one-shot)', () => {
  async function renderSeed(search: string): Promise<void> {
    Object.defineProperty(window, 'location', { value: { ...window.location, search }, configurable: true, writable: true })
    const React = await import('react')
    const { render } = require('@testing-library/react') as typeof import('@testing-library/react')
    const useHostStore = sharedStore()
    // Mirrors packages/host/src/providers/Providers.tsx DebugSeed.
    function DebugSeed() {
      const setDebug = useHostStore((s) => s.setDebug)
      React.useEffect(() => {
        if (new URLSearchParams(window.location.search).get('debug') === 'true') setDebug(true)
      }, [setDebug])
      return null
    }
    render(React.createElement(DebugSeed))
  }

  it('seeds debug from the URL', async () => {
    await renderSeed('?debug=true')
    expect(sharedStore().getState().debug).toBe(true)
    expect(storage.get('bakin-debug')).toBe('true')
  })

  it('does not activate debug without the param', async () => {
    await renderSeed('')
    expect(sharedStore().getState().debug).toBe(false)
  })

  it('a toggle-off sticks across a reconnect refresh (no reseed)', async () => {
    await renderSeed('?debug=true')
    const store = sharedStore()
    act(() => { store.getState().toggleDebug() })
    await act(async () => { await store.getState().refreshActivity() })
    expect(store.getState().debug).toBe(false)
  })
})
