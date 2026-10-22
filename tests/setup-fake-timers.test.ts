/**
 * The fake-timer shim's drain contract (tests/setup.ts `drainMicrotasks`):
 * after each fake fire, and whenever nothing is due, every microtask runnable
 * at that point runs to completion (one real setImmediate turn). It does not
 * block on a dynamic import(), I/O or later immediates — those stay the test's
 * job. Pure: no app modules.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

type Gated = { __fakeTimerGate?: Promise<void> }

describe('fake-timer drain', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('a deep promise chain completes within one advance', async () => {
    let done = false
    void (async () => {
      let chain: Promise<void> = Promise.resolve()
      for (let i = 0; i < 200; i++) chain = chain.then(() => undefined)
      await chain
      done = true
    })()
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })

  it('a 0 ms fake timer enqueued from a microtask fires within the same advance; a later one waits for the next', async () => {
    const fired: string[] = []
    void Promise.resolve().then(() => {
      setTimeout(() => { fired.push('now') }, 0)
      setTimeout(() => { fired.push('later') }, 5)
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(fired).toEqual(['now'])
    await vi.advanceTimersByTimeAsync(5)
    expect(fired).toEqual(['now', 'later'])
  })

  it('runAllTimersAsync drains a retry-with-backoff chain', async () => {
    let attempts = 0
    const retry = () => {
      setTimeout(() => {
        attempts += 1
        if (attempts < 3) void Promise.resolve().then(retry)
      }, 10 * attempts + 1)
    }
    retry()
    await vi.runAllTimersAsync()
    expect(attempts).toBe(3)
  })

  it('does not block on a dynamic import whose module is gated; the import completes once the gate opens', async () => {
    let open!: () => void
    ;(globalThis as Gated).__fakeTimerGate = new Promise<void>((resolve) => { open = resolve })
    let settled = false
    const pending = import('./fixtures/fake-timers/gated-module').then((m) => { settled = true; return m.loaded })
    try {
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toBe(false)
      open()
      expect(await pending).toBe(true)
      expect(settled).toBe(true)
    } finally {
      delete (globalThis as Gated).__fakeTimerGate
    }
  })
})
