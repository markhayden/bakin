/**
 * Runtime-adapter conformance suite (SPEC R23) — THE ACCEPTANCE GATE for any
 * runtime adapter. Every implementation (OpenClaw, Pi, the dev mock, and any
 * future adapter) must pass these cases; a new adapter is not done until its
 * runner file here is green. Cases assert CONTRACT behavior only — anything
 * pinned here must hold for every conforming runtime, never provider quirks.
 *
 * v1 scope (T25): messaging pins. Stream/capability/provisioning/ping pins
 * land in T26; capability-shape honesty in T27.
 *
 * Deliberately NOT pinned: send-level idempotency. `messaging.send` is NOT
 * idempotent at the contract level — callers own dedupe (the execution
 * ledger's run claims). OpenClaw's gateway idempotency key is an adapter
 * implementation detail, not a contract guarantee (audit finding H4).
 *
 * Structure: each check is a plain async function that THROWS on violation
 * (`runtimeConformanceChecks`), and `runRuntimeConformanceSuite` wraps them
 * in describe/it. The teeth test invokes the checks directly against an
 * intentionally-broken adapter to prove the suite fails non-conforming
 * implementations.
 */
import { describe, it } from 'bun:test'
import type { AgentRuntimeAdapter, ChatChunk, MessageResult } from '../../../packages/core/src/adapters/runtime'
import { RuntimeError } from '../../../packages/core/src/adapters/runtime'

export interface RuntimeConformanceTarget {
  runtime: AgentRuntimeAdapter
  /** An agent that exists on this runtime and can complete turns. */
  agentId: string
  /** Fresh, unique thread id per call. */
  newThreadId(): string
  /** Seed/prepare one ordinary successful turn (e.g. Pi seeds a provider script). */
  prepareOkTurn?(): void | Promise<void>
  /**
   * A send promise that MUST reject with a typed RuntimeError. The target
   * owns the failure recipe (provider 500, gateway error mode, pre-aborted
   * signal for the mock — whatever this runtime can actually fail with).
   */
  failingSend(): Promise<MessageResult>
  /** When set, the failing rejection must carry exactly this kind. */
  expectedFailingKind?: string
  /**
   * Start a turn and abort it mid-flight (the target owns the timing — slow
   * provider script, slow gateway mode, or an immediate abort for the mock).
   * `settled` is the send promise; it must reject kind 'aborted'.
   */
  startAbortableTurn(): Promise<{ settled: Promise<MessageResult> }> | { settled: Promise<MessageResult> }
}

function fail(message: string): never {
  throw new Error(`conformance violation: ${message}`)
}

function assertTypedRuntimeError(err: unknown, expectedKind?: string): void {
  if (!(err instanceof RuntimeError)) {
    fail(`messaging rejection is not a RuntimeError (got ${err?.constructor?.name ?? typeof err}: ${String(err)})`)
  }
  if (typeof err.kind !== 'string' || err.kind.length === 0) {
    fail('RuntimeError.kind is missing/empty — core classifies on kind, never message text')
  }
  if (expectedKind !== undefined && err.kind !== expectedKind) {
    fail(`expected kind '${expectedKind}', got '${err.kind}'`)
  }
}

export const runtimeConformanceChecks = {
  /** Threaded sends return the provider session identity for forensics/usage attribution. */
  async threadedSendReturnsSessionId(target: RuntimeConformanceTarget): Promise<void> {
    await target.prepareOkTurn?.()
    const result = await target.runtime.messaging.send({
      agentId: target.agentId,
      content: 'conformance: threaded send',
      threadId: target.newThreadId(),
    })
    const sessionId = result.metadata?.sessionId
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      fail('threaded send returned no metadata.sessionId')
    }
  },

  /** Caller aborts settle as kind 'aborted' — terminal, clean, never a recovery-ladder entry. */
  async abortSettlesAsAbortedKind(target: RuntimeConformanceTarget): Promise<void> {
    const { settled } = await target.startAbortableTurn()
    let caught: unknown = null
    try {
      await settled
    } catch (err) {
      caught = err
    }
    if (caught === null) fail('aborted turn resolved instead of rejecting')
    assertTypedRuntimeError(caught, 'aborted')
  },

  /** Messaging failures are typed RuntimeErrors — kind present, no message-string classification. */
  async failuresAreTypedRuntimeErrors(target: RuntimeConformanceTarget): Promise<void> {
    let caught: unknown = null
    try {
      await target.failingSend()
    } catch (err) {
      caught = err
    }
    if (caught === null) fail('failing send resolved instead of rejecting')
    assertTypedRuntimeError(caught, target.expectedFailingKind)
  },

  /** Streams yield `done` exactly once, and it is the final chunk (R5). */
  async streamDoneExactlyOnceAndLast(target: RuntimeConformanceTarget): Promise<void> {
    await target.prepareOkTurn?.()
    const chunks: ChatChunk[] = []
    for await (const chunk of target.runtime.messaging.stream({
      agentId: target.agentId,
      content: 'conformance: stream turn',
      threadId: target.newThreadId(),
    })) {
      chunks.push(chunk)
    }
    const doneIndexes = chunks.map((c, i) => (c.type === 'done' ? i : -1)).filter((i) => i >= 0)
    if (doneIndexes.length !== 1) {
      fail(`stream yielded ${doneIndexes.length} done chunks (must be exactly 1)`)
    }
    if (doneIndexes[0] !== chunks.length - 1) {
      fail(`done was not the final chunk (done at ${doneIndexes[0]}, ${chunks.length - 1 - doneIndexes[0]} chunk(s) after it)`)
    }
  },
} as const

export function runRuntimeConformanceSuite(name: string, getTarget: () => RuntimeConformanceTarget): void {
  describe(`runtime conformance: ${name}`, () => {
    it('threaded send returns metadata.sessionId', async () => {
      await runtimeConformanceChecks.threadedSendReturnsSessionId(getTarget())
    })

    it("abort settles as kind 'aborted'", async () => {
      await runtimeConformanceChecks.abortSettlesAsAbortedKind(getTarget())
    })

    it('messaging failures are typed RuntimeErrors', async () => {
      await runtimeConformanceChecks.failuresAreTypedRuntimeErrors(getTarget())
    })

    it('stream yields done exactly once, last', async () => {
      await runtimeConformanceChecks.streamDoneExactlyOnceAndLast(getTarget())
    })
  })
}
