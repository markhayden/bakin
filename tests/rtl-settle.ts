/**
 * Per-test RTL settle + cleanup for bun:test.
 *
 * Import (side-effect) from EVERY test file that renders with
 * @testing-library/react:
 *
 *   import '../rtl-settle'   // path relative to the test file
 *
 * Facts this design rests on (each proven by probes; see
 * tests/components/rtl-settle-probe.test.tsx and PR #640):
 *
 * 1. bun:test itself CLEARS document.body between tests when happy-dom is
 *    registered — but it does not unmount React roots. Roots survive their
 *    test, detached, with whatever async work they still had in flight.
 * 2. RTL auto-cleanup is inert under bun — test globals are invisible at
 *    module-eval time, so RTL's feature-detect fails in every file. Roots
 *    accumulate unless a hook unmounts them.
 * 3. A bare synchronous `cleanup()` (which several files already had) still
 *    races: on a slow machine an in-flight time-sliced render can be
 *    mid-slice when the unmount lands — "Attempted to synchronously unmount
 *    a root while React was already rendering" — poisoning the next tests
 *    in the file (the kanban/TaskCard CI failures, unreproducible on fast
 *    dev hardware).
 *
 * The fix: unmount INSIDE act(). act's contract is to flush/join in-flight
 * React work before running its callback, so the unmount can never land
 * mid-render. The act-environment flag is enabled only for the hook's
 * duration — leaving it on globally fails ~450 component tests written
 * without act() discipline, and importing RTL from the PRELOAD trips its
 * self-registration (see tests/setup.ts). This module must be imported by
 * the test file itself.
 */
import { afterEach } from 'bun:test'
import { act, cleanup, configure } from '@testing-library/react'

/**
 * waitFor's 1s default is an OBSERVATION window, not a bound under test — it
 * exists so a hung condition fails fast rather than hanging the run. On a
 * loaded CI runner the window itself starves: a poll that costs milliseconds
 * locally has been observed giving up after 8s of wall clock because the
 * runner never scheduled the retry. Widening the window cannot make a wrong
 * assertion pass (waitFor still fails when the condition never holds) and no
 * test in this suite asserts that a waitFor times out. Anything genuinely
 * hung is caught by bun's per-test --timeout instead.
 */
configure({ asyncUtilTimeout: 15_000 })

// Captured at module eval — BEFORE any test can install fake timers (the vi
// shim replaces globalThis.setTimeout). Yielding through a faked setTimeout
// would never resolve and time the hook out at the per-test limit.
const realSetTimeout = globalThis.setTimeout

function realTimerYield(ms = 0): Promise<void> {
  return new Promise<void>((resolve) => realSetTimeout(resolve, ms))
}

/**
 * One round-trip through the SAME channel React's scheduler uses to resume
 * yielded time-sliced renders. Our message queues BEHIND any pending
 * continuation, so when it delivers, every previously-scheduled slice has
 * run. Raced with a real-timer fallback so a broken MessageChannel can
 * never hang the hook.
 */
function schedulerTick(): Promise<void> {
  return Promise.race([
    new Promise<void>((resolve) => {
      const ch = new MessageChannel()
      ch.port1.onmessage = () => resolve()
      ch.port2.postMessage(null)
    }),
    realTimerYield(50),
  ])
}

/**
 * Drain in-flight React work until quiescent. React 19 REFUSES root.unmount()
 * while a yielded concurrent render is paused between slices — not just
 * inside a render callstack — so act(unmount) alone cannot make unmounting
 * safe (PR #640's gap, surfaced by PR #643's CI): the paused render must be
 * allowed to RESUME (its MessageChannel continuation) and COMPLETE first.
 * Also exported for tests that end interactions with work deliberately in
 * flight (e.g. asserting a fetch call was made while the response-handling
 * re-render is still pending): `await settleReact()` as the last statement
 * makes the test honest about its terminal state.
 */
export async function settleReact(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await schedulerTick()    // let paused render slices resume + finish
    await realTimerYield(0)  // let timer-scheduled work (happy-dom rAF) land
  }
}

afterEach(async () => {
  const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const prev = g.IS_REACT_ACT_ENVIRONMENT
  g.IS_REACT_ACT_ENVIRONMENT = true
  try {
    await settleReact()
    await act(async () => {
      // The unmount runs under act (joins act-visible work) AFTER the
      // scheduler drain above let any yielded render complete — unmounting
      // between paused slices is what React 19 forbids.
      cleanup()
    })
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = prev
  }
})
