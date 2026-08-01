/**
 * Waiting primitives for tests.
 *
 * Four files had each hand-rolled their own version of this under three
 * different names and three different bounds. Worse, ~78 sites across the suite
 * waited with a bare `await new Promise(r => setTimeout(r, 20))`, which is a bet
 * that the machine finishes some work within 20ms. That bet is fine on a quiet
 * dev box and loses on a loaded CI runner — one such sleep (a detached relay
 * behind three dynamic imports) failed roughly one run in four and cost a
 * release attempt.
 *
 * The rule this module encodes:
 *
 *   Asserting something DID happen  -> waitUntil(). Polls the real condition, so
 *                                      it returns the moment the work lands and
 *                                      fails loudly with a label if it never does.
 *                                      Fast machines get faster; slow machines
 *                                      still pass.
 *
 *   Asserting something did NOT     -> settleFor(). You cannot poll for the
 *   happen                             absence of an event: the poll either
 *                                      returns immediately (proving nothing) or
 *                                      needs the same fixed window anyway. So the
 *                                      window stays — but the reason becomes
 *                                      mandatory and greppable.
 *
 * Prefer awaiting a real terminal signal over either of these when the code under
 * test exposes one (a settled promise, a done event, a recorded call). Both of
 * these are for when it does not.
 */

/** Captured before any test can install fake timers over the global. */
const realSetTimeout = globalThis.setTimeout

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, ms))
}

export interface WaitUntilOptions {
  /** Named in the failure message. Say what you were waiting FOR, not "condition". */
  label: string
  /** Upper bound before failing. Generous by default: this is an observation
   *  window, not a performance assertion, and a loaded runner can stall a poll
   *  for seconds without anything being wrong. */
  timeoutMs?: number
  /** Poll interval. Small — the point is to return as soon as the work lands. */
  intervalMs?: number
}

/**
 * Poll until `condition` is true. Returns as soon as it holds; throws a labeled
 * error if it never does.
 *
 * Use for any assertion of the form "X happened": the awaited state IS the
 * condition, so this is deterministic where a fixed sleep is a guess.
 */
export async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  options: WaitUntilOptions,
): Promise<void> {
  const { label, timeoutMs = 10_000, intervalMs = 2 } = options
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await condition()) return
    if (Date.now() >= deadline) {
      throw new Error(`waitUntil timed out after ${timeoutMs}ms waiting for: ${label}`)
    }
    await sleep(intervalMs)
  }
}

/**
 * Wait a fixed window because there is nothing to poll for.
 *
 * `why` is required and is the entire point: it forces the author to state what
 * absence is being proven ("no second dispatch should arrive"), so a later reader
 * can tell a deliberate settle from a leftover guess. If you find yourself
 * writing "wait" or "let it finish", you want waitUntil instead.
 */
export async function settleFor(ms: number, why: string): Promise<void> {
  if (!why.trim()) {
    throw new Error('settleFor requires a reason describing what absence is being proven')
  }
  await sleep(ms)
}
