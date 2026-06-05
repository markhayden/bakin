/**
 * E2E: session-death detection through the full adapter ↔ mock-gateway path
 * (session-death hardening P15, Checkpoint 5).
 *
 * The imitation-crab gateway accepts the turn, writes an oversized-
 * interrupted trajectory to the mock OpenClaw home, and never sends a final
 * frame — exactly the incident shape. The adapter's fail-fast watcher must
 * surface a diagnosed RuntimeTurnError in seconds, not 630s. (Recovery-
 * ladder behavior on top of this error is covered at the dispatch layer in
 * tests/core/dispatch-session-death.test.ts.)
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { createImitationCrabHarness, type ImitationCrabHarness } from '../../dev/imitation-crab/harness'
import { RuntimeTurnError } from '../../packages/core/src/adapters/runtime'

describe('imitation-crab session-death / slow / idle-timeout modes', () => {
  let harness: ImitationCrabHarness | null = null

  afterEach(async () => {
    await harness?.close()
    harness = null
    delete process.env.OPENCLAW_MOCK_CHAT_DELAY_MS
  })

  it('session-death mode: a threaded turn rejects fast with the full oversized diagnosis (CP5)', async () => {
    harness = await createImitationCrabHarness({ chatMode: 'session-death' })
    const { runtime } = harness.services

    const startedAt = Date.now()
    try {
      await runtime.messaging.send({
        agentId: 'jessica',
        content: 'produce six deliverables',
        threadId: 'task:t-e2e:d1',
        metadata: { oversizedOutputBytes: 128 * 1024 },
      })
      throw new Error('expected send to reject')
    } catch (err) {
      const elapsed = Date.now() - startedAt
      expect(err).toBeInstanceOf(RuntimeTurnError)
      const diagnosis = (err as RuntimeTurnError).diagnosis
      expect(diagnosis.reason).toBe('session_interrupted')
      expect(diagnosis.sessionStatus).toBe('interrupted')
      expect(diagnosis.oversizedOutput).toBe(true)
      expect(diagnosis.outputTruncated).toBe(true)
      expect(diagnosis.completionBytes).toBe(262_144)
      expect(diagnosis.lastToolCall).toBe('bakin_exec_tasks_log_progress')
      expect(diagnosis.salvagedText?.length).toBe(262_144)
      expect(diagnosis.detail).toContain('oversized model completion')
      // Death written at ~150ms; fail-fast budget is a couple poll intervals.
      expect(elapsed).toBeLessThan(3000)
    }
  })

  it('idle-timeout mode: the structured error maps to RuntimeTurnError(runtime_timeout)', async () => {
    harness = await createImitationCrabHarness({ chatMode: 'idle-timeout' })
    const { runtime } = harness.services

    try {
      await runtime.messaging.send({ agentId: 'patch', content: 'do work', threadId: 'task:t-idle:d1' })
      throw new Error('expected send to reject')
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeTurnError)
      expect((err as RuntimeTurnError).diagnosis.reason).toBe('runtime_timeout')
    }
  })

  it('slow mode: the turn completes after the configured delay (no false death)', async () => {
    process.env.OPENCLAW_MOCK_CHAT_DELAY_MS = '400'
    harness = await createImitationCrabHarness({ chatMode: 'slow' })
    const { runtime } = harness.services

    const startedAt = Date.now()
    const result = await runtime.messaging.send({
      agentId: 'pixel',
      content: 'take your time',
      threadId: 'task:t-slow:d1',
    })
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(380)
    expect(result.content).toContain('Acknowledged after a slow turn')
    expect(result.metadata?.sessionId).toBeDefined()
  })
})
