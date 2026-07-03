import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// waitForDevChild is pure, but src/core/cli pulls in the settings/onboarding
// graph — pin the content dir to a temp path so nothing can read ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-cli-dev-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
}))

import { waitForDevChild } from '../../src/core/cli'

class FakeChild extends EventEmitter {
  killed = false
  killCalls: string[] = []

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killCalls.push(String(signal ?? 'SIGTERM'))
    if (signal === 'SIGKILL') this.killed = true
    return true
  }
}

class FakeSignalProc extends EventEmitter {
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): this {
    return super.on(event, listener)
  }

  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): this {
    return super.off(event, listener)
  }

  signal(event: 'SIGINT' | 'SIGTERM'): void {
    this.emit(event)
  }

  listenerTotal(event: 'SIGINT' | 'SIGTERM'): number {
    return this.listenerCount(event)
  }
}

describe('waitForDevChild', () => {
  let child: FakeChild
  let signals: FakeSignalProc

  beforeEach(() => {
    child = new FakeChild()
    signals = new FakeSignalProc()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the wrapper alive on first Ctrl-C without double-signaling the child', async () => {
    let resolved: number | null = null
    const result = waitForDevChild(child, undefined, signals).then((code) => {
      resolved = code
      return code
    })

    signals.signal('SIGINT')
    await vi.advanceTimersByTimeAsync(1)

    expect(child.killCalls).toEqual([])
    expect(resolved).toBeNull()

    child.emit('close', 0, null)
    expect(await result).toBe(0)
    expect(resolved as number | null).toBe(0)
    expect(signals.listenerTotal('SIGINT')).toBe(0)
    expect(signals.listenerTotal('SIGTERM')).toBe(0)
  })

  it('force-kills the child on a second signal', async () => {
    const result = waitForDevChild(child, undefined, signals)
    signals.signal('SIGINT')
    signals.signal('SIGINT')

    expect(child.killCalls).toEqual(['SIGKILL'])
    child.emit('close', null, 'SIGKILL')
    expect(await result).toBe(1)
  })

  it('force-kills the child if it ignores the first signal grace window', async () => {
    const result = waitForDevChild(child, undefined, signals)
    signals.signal('SIGTERM')

    await vi.advanceTimersByTimeAsync(7999)
    expect(child.killCalls).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(child.killCalls).toEqual(['SIGKILL'])

    child.emit('close', null, 'SIGKILL')
    expect(await result).toBe(1)
  })

  it('returns shell-style exit code when the child closes from SIGINT', async () => {
    const result = waitForDevChild(child, undefined, signals)
    child.emit('close', null, 'SIGINT')
    expect(await result).toBe(130)
  })

  it('exits nonzero on spawn failure even though close(null, null) lands first', async () => {
    const reported: string[] = []
    const result = waitForDevChild(child, async (err) => {
      // Simulate the async failure report; resolution must wait for it.
      await Promise.resolve()
      reported.push(err.message)
    }, signals)

    // Node/Bun ordering for a spawn failure: 'error' first, then close(null, null).
    child.emit('error', new Error('spawn bun ENOENT'))
    child.emit('close', null, null)

    expect(await result).toBe(1)
    expect(reported).toEqual(['spawn bun ENOENT'])
  })

  it('still exits 0 for a clean close with no error', async () => {
    const result = waitForDevChild(child, undefined, signals)
    child.emit('close', null, null)
    expect(await result).toBe(0)
  })
})
