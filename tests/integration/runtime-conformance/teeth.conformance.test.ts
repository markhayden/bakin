/**
 * Teeth proof: the conformance suite must FAIL a non-conforming adapter.
 * This intentionally-broken in-file adapter violates each pinned behavior
 * (no sessionId, double-done + trailing chunk, untyped errors, abort
 * resolving instead of rejecting), and every check is asserted to REJECT.
 * The checks are invoked directly (they throw on violation) — same functions
 * the describe/it wrapper runs, so a check that goes toothless fails here.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-runtime-conf-teeth-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import type { ChatChunk } from '../../../packages/core/src/adapters/runtime'
import { createMockRuntimeAdapter } from '../../../packages/core/src/adapters/runtime/testing'
import { runtimeConformanceChecks, type RuntimeConformanceTarget } from './conformance'

/** Every violation in one adapter: the anti-conformance fixture. */
function createBrokenAdapter() {
  const base = createMockRuntimeAdapter()
  return {
    ...base,
    messaging: {
      // No metadata at all — violates the threaded-sessionId pin.
      send: async () => ({ id: 'broken-1' }),
      // Double done, and a text chunk AFTER done — violates the stream pin.
      stream: async function* (): AsyncIterable<ChatChunk> {
        yield { type: 'text', content: 'broken' }
        yield { type: 'done' }
        yield { type: 'done' }
        yield { type: 'text', content: 'after done' }
      },
    },
  }
}

function brokenTarget(): RuntimeConformanceTarget {
  const runtime = createBrokenAdapter()
  return {
    runtime,
    agentId: 'main',
    newThreadId: () => `teeth:${randomUUID()}`,
    // Rejects with a PLAIN Error — violates the typed-taxonomy pin.
    failingSend: () => Promise.reject(new Error('untyped explosion')),
    // Abort "settles" by RESOLVING — violates the aborted-kind pin.
    startAbortableTurn: () => ({ settled: Promise.resolve({ id: 'broken-2' }) }),
  }
}

describe('conformance suite teeth (broken adapter must fail every check)', () => {
  it('fails the threaded-sessionId check', async () => {
    await expect(runtimeConformanceChecks.threadedSendReturnsSessionId(brokenTarget()))
      .rejects.toThrow(/conformance violation: threaded send returned no metadata.sessionId/)
  })

  it('fails the abort-kind check', async () => {
    await expect(runtimeConformanceChecks.abortSettlesAsAbortedKind(brokenTarget()))
      .rejects.toThrow(/conformance violation: aborted turn resolved/)
  })

  it('fails the typed-errors check', async () => {
    await expect(runtimeConformanceChecks.failuresAreTypedRuntimeErrors(brokenTarget()))
      .rejects.toThrow(/conformance violation: messaging rejection is not a RuntimeError/)
  })

  it('fails the stream done-exactly-once check', async () => {
    await expect(runtimeConformanceChecks.streamDoneExactlyOnceAndLast(brokenTarget()))
      .rejects.toThrow(/conformance violation: stream yielded 2 done chunks/)
  })
})
