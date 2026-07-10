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
import { act, cleanup } from '@testing-library/react'

// Captured at module eval — BEFORE any test can install fake timers (the vi
// shim replaces globalThis.setTimeout). Yielding through a faked setTimeout
// would never resolve and time the hook out at the per-test limit.
const realSetTimeout = globalThis.setTimeout

afterEach(async () => {
  const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const prev = g.IS_REACT_ACT_ENVIRONMENT
  g.IS_REACT_ACT_ENVIRONMENT = true
  try {
    await act(async () => {
      // One macrotask yield inside act lets already-queued timers (happy-dom
      // backs rAF with timers) land so their updates are flushed by act...
      await new Promise<void>((resolve) => realSetTimeout(resolve, 0))
      // ...and the unmount itself runs under act, which joins any in-flight
      // render before executing — the race from fact 3 is structurally gone.
      cleanup()
    })
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = prev
  }
})
