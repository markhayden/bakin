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

// ---------------------------------------------------------------------------
// Test-run environment.
//
// This lives here, not in bunfig.toml: bun 1.3.13 does not read a [test.env]
// section (probed — a var set there arrives `undefined`; NODE_ENV shows up only
// because `bun test` sets it itself). The preload is the earliest thing that
// actually runs.
//
// Logger chatter buried real failures under ~3,958 lines (1,641 from storage-db
// alone) of an 11,885-line run. `silent` is a format the logger already supports,
// so no logging code changes shape.
//
// `??=` keeps the escape hatch honest — an explicit shell value always wins:
//   BAKIN_CONSOLE_FORMAT=pretty bun test path/to.test.ts --isolate
// Tests that assert the logger WRITES must set the format themselves rather than
// inherit it (see tests/core/logger.test.ts's withConsoleEnv).
// ---------------------------------------------------------------------------
process.env.BAKIN_CONSOLE_FORMAT ??= 'silent'

// Disable RTL's auto-registration. Read the block in tests/rtl-settle.ts before
// changing this — RTL otherwise installs a bare synchronous afterEach(cleanup)
// that races the settle-then-unmount hook written specifically to replace it,
// and flips React's act environment on for every RTL file as a side effect.
// We own both, deliberately, in rtl-settle.
process.env.RTL_SKIP_AUTO_CLEANUP = 'true'

GlobalRegistrator.register()

// ---------------------------------------------------------------------------
// Cross-file isolation is provided by `--isolate` (in the test script AND the
// CI workflows), NOT by cleanup hooks here. Facts before you "improve" this:
//  1. RTL auto-registration IS active under bun 1.3.13 — its test globals ARE
//     visible when a test file imports RTL, so `typeof beforeAll === 'function'`
//     succeeds and @testing-library/react/dist/index.js:46 installs BOTH a bare
//     synchronous afterEach(cleanup) AND beforeAll(setReactActEnvironment(true)).
//     (An older comment here claimed the opposite. It was wrong, and that error
//     is why ~294 act warnings accumulated unnoticed: they looked like sloppy
//     test authorship rather than a global mode nobody had chosen. Verified by
//     defineProperty-probing globalThis.IS_REACT_ACT_ENVIRONMENT and logging the
//     setter's stack — see .claude/knowledge/test-suite-health.md.)
//     We therefore set RTL_SKIP_AUTO_CLEANUP above and own both behaviors in
//     tests/rtl-settle.ts, where the settle-then-unmount hook can't be raced.
//  2. Do NOT import @testing-library/react here. A preload import makes RTL
//     self-register before any test file loads, and a lazy require() inside a
//     hook is worse ("Cannot call beforeAll() inside a test", ~5.7k failures).
//  3. Do NOT set React's act environment globally from this preload. It is
//     scoped to rtl-settle on purpose: Ink is also a React renderer, and act
//     mode changes how React flushes, so a global flag breaks 31 CLI TUI tests
//     (measured). The "~450 component tests" an older comment warned about was
//     real but misattributed — the casualties are Ink's terminal renderer, not
//     RTL's DOM tests.
// `--isolate` gives each file its own process, which also contains
// mock.module overlay leakage (see CLAUDE.md Testing Rules).
//
// INTRA-file root leakage is the other dimension (--isolate can't help):
// bun clears document.body between tests but never unmounts React roots, and
// React 19 refuses unmounting while a yielded time-sliced render is paused
// between slices — a state act() cannot join (it resumes via the scheduler's
// MessageChannel, not the act queue). Every RTL-rendering test file imports
// tests/rtl-settle.ts, whose afterEach drains the scheduler (settleReact:
// MessageChannel round-trips + timer yields) and only then unmounts inside
// act(). Tests that end with work deliberately in flight (fetch-call
// assertions racing the response re-render) call settleReact() themselves —
// see that module for the full fact chain.
// tests/components/kanban-dnd.test.tsx was quarantined to a serial gating
// step for a while (issue #650). Root cause turned out to be timing-gated,
// not scheduler-exotic: its search-filter test let useSearch's debounced
// /search? GET hit a stub that returned the board payload, poisoning
// results with undefined — only runners slow enough for the 300ms debounce
// to elapse mid-test ever saw it. Un-quarantined 2026-07-20.
// ---------------------------------------------------------------------------

// NOTE: we don't register a global main-agent stub here — bun:test has no
// per-path unmock, and the main-agent.test.ts file exercises the real
// resolution logic. Tests that want the stub add their own
// `mock.module('@bakin/core/main-agent', ...)` at the top of the file.

// TanStack Router shim — component tests run outside a <RouterProvider>
// context; the real hooks throw. See tests/shims/tanstack-router.ts.
// Sync factory via require — async factories (returning a Promise) hang
// bun:test and segfault in some React component tests.
mock.module('@tanstack/react-router', () => require('./shims/tanstack-router'))

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
const pendingTimers: Array<{ fn: () => void; at: number; id: number; interval?: number }> = []
let nextTimerId = 1
let realSetTimeout: typeof setTimeout | null = null
let realClearTimeout: typeof clearTimeout | null = null
let realSetInterval: typeof setInterval | null = null
let realClearInterval: typeof clearInterval | null = null

// vi.mock shim — bun:test's mock.module hangs on async factories for node
// builtins, so tests that need partial-mock ("spread actual, override a few
// methods") use mock.module with a sync factory + require() directly. Our
// shim just delegates straight to mock.module.

const vi = {
  // Mock constructors
  fn: mock,
  spyOn,
  mock: mock.module,
  doMock: mock.module,
  unmock: (path: string) => {
    // Re-register the path with the real module so test overrides fall through.
    try {
      const real = require(path)
      mock.module(path, () => real)
    } catch {
      // Path may not be requirable (ESM-only, alias not yet resolved); skip.
    }
  },
  mocked: <T>(x: T): T => x,
  hoisted: <T>(fn: () => T): T => fn(),
  importActual: async <T = unknown>(path: string): Promise<T> => {
    // Try require first (works for CJS + Node builtins); fall back to dynamic import
    try {
      return require(path) as T
    } catch {
      return (await import(path)) as T
    }
  },
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
    realSetInterval = globalThis.setInterval as typeof setInterval
    realClearInterval = globalThis.clearInterval as typeof clearInterval
    const fakeSetTimeout = ((fn: () => void, ms: number) => {
      const id = nextTimerId++
      pendingTimers.push({ fn, at: (fakeTime ?? 0) + ms, id })
      return id as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout
    const fakeClearTimeout = ((id: number) => {
      const idx = pendingTimers.findIndex(t => t.id === id)
      if (idx >= 0) pendingTimers.splice(idx, 1)
    }) as typeof clearTimeout
    const fakeSetInterval = ((fn: () => void, ms: number) => {
      const id = nextTimerId++
      pendingTimers.push({ fn, at: (fakeTime ?? 0) + ms, id, interval: ms })
      return id as unknown as ReturnType<typeof setInterval>
    }) as typeof setInterval
    const fakeClearInterval = ((id: number) => {
      const idx = pendingTimers.findIndex(t => t.id === id)
      if (idx >= 0) pendingTimers.splice(idx, 1)
    }) as typeof clearInterval
    globalThis.setTimeout = fakeSetTimeout
    globalThis.clearTimeout = fakeClearTimeout
    globalThis.setInterval = fakeSetInterval
    globalThis.clearInterval = fakeClearInterval
  },
  useRealTimers: () => {
    if (!realSetTimeout) return
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout!
    globalThis.setInterval = realSetInterval!
    globalThis.clearInterval = realClearInterval!
    realSetTimeout = null
    realClearTimeout = null
    realSetInterval = null
    realClearInterval = null
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
    // Run due timers + any new timers enqueued by their callbacks (including
    // re-enqueued interval timers) up to the new fakeTime. Microtask flushes
    // between fires let awaited callbacks register their next setTimeout.
    for (let guard = 0; guard < 10_000; guard++) {
      const due = pendingTimers.filter(t => t.at <= fakeTime!)
      if (due.length === 0) {
        await flushMicrotasks(4)
        const again = pendingTimers.filter(t => t.at <= fakeTime!)
        if (again.length === 0) return
      }
      due.sort((a, b) => a.at - b.at)
      for (const t of due) {
        const idx = pendingTimers.findIndex(p => p.id === t.id)
        if (idx >= 0) pendingTimers.splice(idx, 1)
        t.fn()
        if (t.interval !== undefined) {
          pendingTimers.push({ fn: t.fn, at: (fakeTime ?? 0) + t.interval, id: t.id, interval: t.interval })
        }
        await flushMicrotasks(4)
      }
    }
  },
  runAllTimersAsync: async () => {
    if (fakeTime === null) return
    // Pop and fire one-shot timers one at a time, draining microtasks between
    // each so retry-with-backoff loops can enqueue their *next* setTimeout.
    // Intervals are NOT fired (would infinite loop).
    for (let guard = 0; guard < 10_000; guard++) {
      let oneShot = pendingTimers.filter(t => t.interval === undefined)
      if (oneShot.length === 0) {
        await flushMicrotasks(4)
        oneShot = pendingTimers.filter(t => t.interval === undefined)
        if (oneShot.length === 0) return
      }
      oneShot.sort((a, b) => a.at - b.at)
      const next = oneShot[0]
      const idx = pendingTimers.findIndex(p => p.id === next.id)
      if (idx >= 0) pendingTimers.splice(idx, 1)
      fakeTime = next.at
      setSystemTime(fakeTime)
      next.fn()
      await flushMicrotasks(4)
    }
    throw new Error('runAllTimersAsync exceeded 10000 iterations (likely infinite timer loop)')
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

  // Async wait — poll until fn either returns successfully (vitest semantics)
  // or times out. Matches vitest behavior: a successful return — including
  // void from an expect() — counts as a pass.
  waitFor: async <T>(fn: () => T | Promise<T>, opts: { timeout?: number; interval?: number } = {}): Promise<T> => {
    const timeout = opts.timeout ?? 1000
    const interval = opts.interval ?? 10
    const start = Date.now()
    let lastErr: unknown = null
    while (Date.now() - start < timeout) {
      try {
        return await fn()
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
  // Fire iteratively — setInterval timers re-enqueue on fire. Use a guard to
  // catch runaway schedules.
  for (let guard = 0; guard < 10_000; guard++) {
    const due = pendingTimers.filter(t => t.at <= fakeTime!)
    if (due.length === 0) return
    due.sort((a, b) => a.at - b.at)
    for (const t of due) {
      const idx = pendingTimers.findIndex(p => p.id === t.id)
      if (idx >= 0) pendingTimers.splice(idx, 1)
      t.fn()
      if (t.interval !== undefined) {
        // Re-enqueue for the next period
        pendingTimers.push({ fn: t.fn, at: (fakeTime ?? 0) + t.interval, id: t.id, interval: t.interval })
      }
    }
  }
}

async function flushMicrotasks(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>(resolve => queueMicrotask(() => resolve()))
  }
}

;(globalThis as unknown as { vi: typeof vi }).vi = vi
