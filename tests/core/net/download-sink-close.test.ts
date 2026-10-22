/**
 * downloadToFile's failed-attempt path must await the sink's `close` before the
 * partial-file cleanup runs. The write sink opens asynchronously; a fail-fast
 * attempt (an immediate 404) used to reach `rmSync` before that open created the
 * file, and the late open then left an empty file behind — observable under bun
 * 1.4's faster scheduling (diagnostic matrix, 2026-10-21). The real-HTTP pin is
 * `download.test.ts` ("leaves nothing behind"); this file is the deterministic
 * proof through the `createSink` injection point: a sink double whose open and
 * close the test gates. (Mocking the `fs` builtin itself wedges bun's loader.)
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { EventEmitter } from 'events'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-net-sink-close-${Date.now()}-${Math.random().toString(16).slice(2)}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('../../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { downloadToFile, type DownloadSink } from '../../../packages/core/src/net/download'

/** The minimal surface downloadToFile drives: write/end/destroy + once('drain'|'error'|'close'). */
class FakeSink extends EventEmitter {
  destroyed = false
  constructor(private readonly onDestroy: (sink: FakeSink) => void) { super() }
  write(_chunk: Uint8Array): boolean { return true }
  end(): this { this.emit('close'); return this }
  destroy(): this {
    if (!this.destroyed) {
      this.destroyed = true
      this.onDestroy(this)
    }
    return this
  }
}

const notFound = async () => new Response('missing', { status: 404 })
const macrotasks = async (n: number) => { for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r)) }
const events: string[] = []

beforeEach(() => { mkdirSync(testDir, { recursive: true }); events.length = 0 })
afterAll(() => { rmSync(testDir, { recursive: true, force: true }) })

describe('downloadToFile: cleanup waits for the sink to close', () => {
  it('a late open cannot leave a file behind — close precedes cleanup', async () => {
    const dest = join(testDir, 'late-open.bin')
    let open!: () => void
    const gate = new Promise<void>((resolve) => { open = resolve })
    const createSink = () => new FakeSink((sink) => {
      // The asynchronous open lands AFTER the attempt failed: it creates the
      // file, then the sink closes. Cleanup that ran before this leaves the
      // file behind; cleanup that waits for close removes it.
      void gate.then(() => {
        writeFileSync(dest, '')
        events.push('late-open')
        sink.emit('close')
      })
    }) as unknown as DownloadSink

    let settled = false
    const pending = downloadToFile('http://example.invalid/missing', dest, { fetchImpl: notFound as never, retries: 0, createSink })
      .then(() => { settled = true; throw new Error('resolved unexpectedly') }, (err: unknown) => { settled = true; return err })
    await macrotasks(5)
    // Still waiting for the sink: the attempt has not thrown, so the cleanup
    // (which runs before the rethrow) has not run either.
    expect(settled).toBe(false)
    expect(events).toEqual([])

    open()
    const err = await pending
    expect(String(err)).toMatch(/404/)
    expect(events).toEqual(['late-open'])
    expect(existsSync(dest)).toBe(false)
  })

  it('an errored sink is not "closed" — the rejection waits for close itself', async () => {
    const dest = join(testDir, 'error-then-close.bin')
    let release!: () => void
    const closeGate = new Promise<void>((resolve) => { release = resolve })
    const createSink = () => new FakeSink((sink) => {
      sink.emit('error', new Error('open failed'))
      events.push('error')
      void closeGate.then(() => { events.push('close'); sink.emit('close') })
    }) as unknown as DownloadSink

    let settled = false
    const pending = downloadToFile('http://example.invalid/missing', dest, { fetchImpl: notFound as never, retries: 0, createSink })
      .then(() => { settled = true; throw new Error('resolved unexpectedly') }, (err: unknown) => { settled = true; return err })
    await macrotasks(5)
    // `error` alone must not release the attempt: an implementation that
    // awaited the sink's error/finish promise would have rejected by now.
    expect(settled).toBe(false)
    expect(events).toEqual(['error'])

    release()
    const err = await pending
    expect(String(err)).toMatch(/404/)
    expect(events).toEqual(['error', 'close'])
    expect(existsSync(dest)).toBe(false)
  })
})
