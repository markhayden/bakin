/**
 * Unit tests for scripts/dev-shutdown.ts — the dev-loop signal handling
 * that defers to lifecycle.ts's graceful shutdown once the server has
 * registered its own SIGINT/SIGTERM listeners (#459 defect 1).
 *
 * Uses a fake process object: emitting real signals on the test process
 * would kill the runner.
 */
import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { registerDevShutdown } from '../../scripts/dev-shutdown'

class FakeProc extends EventEmitter {
  exitCalls: number[] = []

  exit(code?: number): void {
    this.exitCalls.push(code ?? 0)
  }
}

interface Harness {
  proc: FakeProc
  tailwindKills: number
  warnings: string[]
  forceKills: number
}

function setup(): Harness {
  const harness: Harness = { proc: new FakeProc(), tailwindKills: 0, warnings: [], forceKills: 0 }
  registerDevShutdown({
    proc: harness.proc,
    killTailwind: () => { harness.tailwindKills++ },
    warn: (message) => { harness.warnings.push(message) },
    // Inject a fake force-kill — the real default self-SIGKILLs, which would
    // kill the test runner (and the unref'd backstop timer would too).
    forceKill: () => { harness.forceKills++ },
  })
  return harness
}

describe('registerDevShutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('solo listener (build phase): kills tailwind and exits 0', () => {
    const h = setup()
    h.proc.emit('SIGTERM')
    expect(h.tailwindKills).toBe(1)
    expect(h.proc.exitCalls).toEqual([0])
  })

  test('solo listener: SIGINT also exits 0', () => {
    const h = setup()
    h.proc.emit('SIGINT')
    expect(h.proc.exitCalls).toEqual([0])
  })

  test('lifecycle listener present: kills tailwind but does NOT exit', () => {
    const h = setup()
    // lifecycle.registerShutdownHandlers() registers after dev.ts,
    // on the same signals — mirror that ordering.
    h.proc.on('SIGTERM', () => {})
    h.proc.emit('SIGTERM')
    expect(h.tailwindKills).toBe(1)
    expect(h.proc.exitCalls).toEqual([])
  })

  test('lifecycle listener registered later still runs on the signal (#459 regression)', () => {
    const h = setup()
    let lifecycleRan = false
    // Mirrors lifecycle.registerShutdownHandlers(): registered after
    // dev.ts on the same signal — listener order means dev runs first
    // and must not exit, or this never executes.
    h.proc.on('SIGTERM', () => { lifecycleRan = true })
    h.proc.emit('SIGTERM')
    expect(lifecycleRan).toBe(true)
    expect(h.proc.exitCalls).toEqual([])
  })

  test('second signal force-kills (never needs a third) with a warning', () => {
    const h = setup()
    h.proc.on('SIGINT', () => {})
    h.proc.emit('SIGINT')
    // First signal: "shutting down" feedback, defers to lifecycle, no exit yet.
    expect(h.proc.exitCalls).toEqual([])
    expect(h.forceKills).toBe(0)
    expect(h.warnings[0]).toContain('shutting down')
    h.proc.emit('SIGINT')
    // Second signal: force-kill immediately (not proc.exit, which may not
    // terminate with a live child), so the user never needs a third.
    expect(h.forceKills).toBe(1)
    expect(h.warnings[h.warnings.length - 1]).toContain('SIGINT')
  })

  test('second signal (mixed signals) force-kills immediately', () => {
    const h = setup()
    h.proc.on('SIGINT', () => {})
    h.proc.on('SIGTERM', () => {})
    h.proc.emit('SIGINT')
    h.proc.emit('SIGTERM')
    expect(h.forceKills).toBe(1)
  })

  test('signal then exit event calls killTailwind twice — dedup is the caller\'s job', () => {
    // The module does not dedupe; scripts/dev.ts guards with
    // `!tailwindChild.killed` so the double call is harmless there.
    const h = setup()
    h.proc.on('SIGTERM', () => {})
    h.proc.emit('SIGTERM')
    h.proc.emit('exit')
    expect(h.tailwindKills).toBe(2)
  })

  test('exit event kills tailwind (covers every JS exit path)', () => {
    const h = setup()
    h.proc.emit('exit')
    expect(h.tailwindKills).toBe(1)
  })

  test('first signal force-kills after the graceful shutdown backstop', async () => {
    const h = setup()
    h.proc.on('SIGINT', () => {})

    h.proc.emit('SIGINT')
    await vi.advanceTimersByTimeAsync(5999)
    expect(h.forceKills).toBe(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(h.forceKills).toBe(1)
    expect(h.warnings[h.warnings.length - 1]).toContain('graceful shutdown took too long')
  })
})
