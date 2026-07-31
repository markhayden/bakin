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
 * 2. RTL's auto-registration IS active under bun 1.3.13 (an older comment here
 *    claimed it was inert — it is not; see tests/setup.ts). It is disabled via
 *    RTL_SKIP_AUTO_CLEANUP in the preload precisely so this module can be the
 *    single owner of both cleanup and the act environment.
 * 3. A bare synchronous `cleanup()` — which is exactly what RTL's auto-cleanup
 *    installs — races: on a slow machine an in-flight time-sliced render can be
 *    mid-slice when the unmount lands — "Attempted to synchronously unmount
 *    a root while React was already rendering" — poisoning the next tests
 *    in the file (the kanban/TaskCard CI failures, unreproducible on fast
 *    dev hardware). For a long stretch RTL's copy was silently running
 *    alongside ours, which is the race this module exists to prevent.
 *
 * The fix: unmount INSIDE act(). act's contract is to flush/join in-flight
 * React work before running its callback, so the unmount can never land
 * mid-render.
 *
 * ACT ENVIRONMENT. Set here, for the whole file, and scoped on purpose: this
 * module is imported by RTL-rendering test files and nothing else. Setting it
 * in the preload instead breaks 31 Ink/CLI TUI tests, because Ink is a React
 * renderer too and act mode changes how React flushes its work (measured —
 * .claude/knowledge/test-suite-health.md). With it on, React reports any state
 * update that lands outside act(), which is the ONLY signal we have for a test
 * ending with work still in flight — the confirmed mechanism for pinning an
 * --isolate worker open forever (#753). tests/setup.ts fails the run on any
 * such warning, so this flag is load-bearing, not diagnostic.
 */
import { afterEach, beforeAll } from 'bun:test'
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

/**
 * Own the act environment for every RTL file (see the module docblock for why
 * it is set here and not in the preload). RTL used to do this as a side effect
 * of its auto-registration; that is now disabled, so this is the single place
 * the mode is chosen.
 */
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

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

/**
 * Run a render/renderHook inside an async act and return its result.
 *
 * The async act window is what lets mount effects — and the fetches they start —
 * settle before the test body continues, instead of landing loose afterwards.
 * Generic so `renderHook`'s result type survives: hoisting the value out of the
 * act callback with an explicit `ReturnType<typeof renderHook>` annotation erases
 * the hook's type and leaves `result.current` as `unknown`.
 */
export async function actRender<T>(render: () => T): Promise<T> {
  let value!: T
  await act(async () => {
    value = render()
  })
  return value
}

afterEach(async () => {
  // No flag juggling here any more — beforeAll set the act environment for the
  // whole file, so this hook simply runs in it.
  //
  // The drain runs INSIDE act. It used to run outside, which meant any update
  // it flushed was — by definition — an update landing outside act, and the
  // gate would blame the test that had just finished. Under parallel load that
  // showed up as 6 phantom KanbanBoard warnings that no amount of fixing the
  // test could remove, because the warning was the teardown's, not the test's.
  // act still flushes the same work; it just joins it instead of watching it.
  await act(async () => {
    await settleReact()
    // The unmount runs under act (joins act-visible work) AFTER the
    // scheduler drain above let any yielded render complete — unmounting
    // between paused slices is what React 19 forbids.
    cleanup()
  })
})
