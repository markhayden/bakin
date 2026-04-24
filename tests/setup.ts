/**
 * Global bun:test setup.
 *
 * 1. Registers happy-dom so component tests have document/window.
 * 2. Mocks the main-agent module at its canonical path so tests don't
 *    read the real ~/.openclaw/ state.
 * 3. Exposes a `vi` compatibility shim on globalThis so the handful of
 *    vitest-era timer/module/global-stub calls we haven't hand-migrated
 *    keep working under bun:test.
 *
 * Test-data leak protection works in two layers:
 *  1. Runtime guards in content-dir.ts and openclaw-home.ts throw if
 *     any test run resolves to the real ~/.bakin/ or ~/.openclaw/.
 *  2. Individual tests must mock those modules or set BAKIN_HOME /
 *     OPENCLAW_HOME to a temp directory.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { mock, setSystemTime, spyOn } from 'bun:test'

GlobalRegistrator.register()

const mainAgentMock = {
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}

mock.module('@bakin/core/main-agent', () => mainAgentMock)

// TanStack Router shim — component tests run outside a <RouterProvider>
// context; the real hooks throw. See tests/shims/tanstack-router.ts.
mock.module('@tanstack/react-router', () => import('./shims/tanstack-router'))

// ---------------------------------------------------------------------------
// `vi` compatibility shim
//
// Legacy vitest-era APIs that remain in a handful of tests. Each maps to a
// bun:test equivalent or a best-effort approximation; semantics match vitest
// closely enough that the suite keeps passing without hand-migrating every
// call site.
// ---------------------------------------------------------------------------

// Track stubbed globals for unstubAllGlobals()
const stubbedGlobals = new Map<string, { present: boolean; value: unknown }>()

// Track fake-timer state (best-effort — bun test has no true fake timers,
// so we simulate by advancing Date.now via setSystemTime + running pending
// micro/macrotasks manually).
let fakeTime: number | null = null
const pendingTimers: Array<{ fn: () => void; at: number; id: number }> = []
let nextTimerId = 1
let realSetTimeout: typeof setTimeout | null = null
let realClearTimeout: typeof clearTimeout | null = null

const vi = {
  // Mock constructors
  fn: mock,
  spyOn,
  mock: mock.module,
  doMock: mock.module,
  unmock: (_path: string) => { /* bun:test doesn't expose per-path unmock; no-op */ },
  mocked: <T>(x: T): T => x,
  hoisted: <T>(fn: () => T): T => fn(),
  importActual: async (path: string) => await import(path),
  clearAllMocks: () => mock.clearAllMocks(),
  restoreAllMocks: () => mock.restore(),
  resetModules: () => { /* bun test handles modules differently — no-op */ },

  // Fake timers — approximate implementation. Overrides setTimeout/clearTimeout
  // globally; advanceTimersByTime runs due callbacks.
  useFakeTimers: () => {
    if (realSetTimeout) return // already faked
    fakeTime = Date.now()
    setSystemTime(fakeTime)
    realSetTimeout = globalThis.setTimeout as typeof setTimeout
    realClearTimeout = globalThis.clearTimeout as typeof clearTimeout
    const fakeSetTimeout = ((fn: () => void, ms: number) => {
      const id = nextTimerId++
      pendingTimers.push({ fn, at: (fakeTime ?? 0) + ms, id })
      return id as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout
    const fakeClearTimeout = ((id: number) => {
      const idx = pendingTimers.findIndex(t => t.id === id)
      if (idx >= 0) pendingTimers.splice(idx, 1)
    }) as typeof clearTimeout
    globalThis.setTimeout = fakeSetTimeout
    globalThis.clearTimeout = fakeClearTimeout
  },
  useRealTimers: () => {
    if (!realSetTimeout) return
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout!
    realSetTimeout = null
    realClearTimeout = null
    fakeTime = null
    pendingTimers.length = 0
    setSystemTime() // restore real clock
  },
  setSystemTime: (d: Date | number) => {
    const ms = typeof d === 'number' ? d : d.getTime()
    fakeTime = ms
    setSystemTime(ms)
  },
  advanceTimersByTime: (ms: number) => {
    if (fakeTime === null) return
    fakeTime += ms
    setSystemTime(fakeTime)
    runDueTimers()
  },
  advanceTimersByTimeAsync: async (ms: number) => {
    if (fakeTime === null) return
    fakeTime += ms
    setSystemTime(fakeTime)
    runDueTimers()
    // allow microtasks to flush
    await new Promise(resolve => queueMicrotask(() => resolve(undefined)))
  },
  runAllTimersAsync: async () => {
    if (fakeTime === null) return
    // Run all due timers, then anything new they enqueued
    while (pendingTimers.length > 0) {
      const next = pendingTimers.shift()!
      fakeTime = next.at
      setSystemTime(fakeTime)
      next.fn()
      await new Promise(resolve => queueMicrotask(() => resolve(undefined)))
    }
  },

  // Global stubs
  stubGlobal: (key: string, value: unknown) => {
    const g = globalThis as Record<string, unknown>
    if (!stubbedGlobals.has(key)) {
      stubbedGlobals.set(key, { present: key in g, value: g[key] })
    }
    g[key] = value
  },
  unstubAllGlobals: () => {
    const g = globalThis as Record<string, unknown>
    for (const [key, { present, value }] of stubbedGlobals) {
      if (present) g[key] = value
      else delete g[key]
    }
    stubbedGlobals.clear()
  },

  // Async wait — poll until predicate is truthy or timeout
  waitFor: async <T>(fn: () => T | Promise<T>, opts: { timeout?: number; interval?: number } = {}): Promise<T> => {
    const timeout = opts.timeout ?? 1000
    const interval = opts.interval ?? 10
    const start = Date.now()
    let lastErr: unknown = null
    while (Date.now() - start < timeout) {
      try {
        const result = await fn()
        if (result) return result
      } catch (err) {
        lastErr = err
      }
      await new Promise(resolve => setTimeout(resolve, interval))
    }
    throw lastErr ?? new Error(`vi.waitFor timed out after ${timeout}ms`)
  },
}

function runDueTimers(): void {
  if (fakeTime === null) return
  const due = pendingTimers.filter(t => t.at <= fakeTime!)
  for (const t of due) {
    const idx = pendingTimers.findIndex(p => p.id === t.id)
    if (idx >= 0) pendingTimers.splice(idx, 1)
    t.fn()
  }
}

;(globalThis as unknown as { vi: typeof vi }).vi = vi
