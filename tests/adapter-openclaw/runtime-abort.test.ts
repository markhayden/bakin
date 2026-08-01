/**
 * MessageArgs.signal → local reject (kind 'aborted') + server-side chat.abort.
 *
 * Live-verified (OpenClaw 2026.6.11, T1 abort fixture
 * tests/fixtures/openclaw-gateway-frames/abort-turn.jsonl): chat.abort with
 * the accepted ack's exact {sessionKey, runId} DOES stop backend `agent` RPC
 * runs — response {ok:true, aborted:true, runIds:[…]}. Before the ack there
 * is nothing runId-addressable, so the frame falls back to the best-known
 * explicit session key (threaded) or is skipped (unthreaded). The local
 * rejection never waits on any of this — it frees Bakin's dispatch slot
 * unconditionally. The post-abort RPC final is status:'timeout' with
 * stopReason:'aborted'; classification is by local abort state, never RPC
 * status.
 */
import { describe, it, expect, afterAll, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testHome = mkdtempSync(join(tmpdir(), 'bakin-test-openclaw-abort-'))

mock.module('../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => testHome,
  getOpenClawPath: (...parts: string[]) => join(testHome, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db') }),
}))
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import { createOpenClawRuntimeAdapter } from '@bakin/adapter-openclaw'
import { RuntimeError } from '../../packages/core/src/adapters/runtime/errors'
import { openClawCliSessionId, openClawExplicitSessionKey } from '../../packages/adapter-openclaw/src/session-store'
import { waitUntil } from '../helpers/wait'

afterAll(() => rmSync(testHome, { recursive: true, force: true }))

type Captured = { method: string; params: Record<string, unknown> }
type FakeAck = { runId: string; sessionKey: string; acceptedAt: number }
type FakeRequestOpts = {
  signal?: AbortSignal
  onAccepted?: (ack: FakeAck) => void
}

/**
 * Fake gateway client mirroring gateway-rpc semantics: the `agent` request
 * hangs until opts.signal aborts (local rejection — exactly what the real
 * client does); every other method resolves immediately. Optional `ack`
 * fires opts.onAccepted synchronously on send (the accepted ack arriving
 * before any abort); optional `abortResponse` overrides the chat.abort res.
 */
function adapterWithHangingGateway(cfg?: { ack?: FakeAck; abortResponse?: Record<string, unknown> }) {
  const adapter = createOpenClawRuntimeAdapter({ settings: { binaryPath: join(testHome, 'bin', 'openclaw') } })
  const auditEvents: Array<{ action: string; data: Record<string, unknown> }> = []
  ;(adapter as unknown as { auditEvent: (event: { action: string; data: Record<string, unknown> }) => void }).auditEvent =
    (event) => { auditEvents.push(event) }
  const captured: Captured[] = []
  const fakeClient = {
    request: (method: string, params: Record<string, unknown>, opts?: FakeRequestOpts) => {
      captured.push({ method, params })
      if (method === 'chat.abort') {
        return Promise.resolve(cfg?.abortResponse ?? { ok: true, aborted: true, runIds: [params.runId ?? 'run-unknown'] })
      }
      if (method !== 'agent') return Promise.resolve({ ok: true })
      if (cfg?.ack) opts?.onAccepted?.(cfg.ack)
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          reject(new RuntimeError('mock gateway request aborted: agent', { kind: 'transport' }))
        }, { once: true })
      })
    },
  }
  ;(adapter as unknown as { openClawChatGateway: () => unknown }).openClawChatGateway = () => fakeClient
  return { adapter, captured, auditEvents }
}

/** Drain the microtask/timer queue so the async chat.abort response settles. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('messaging.send with MessageArgs.signal', () => {
  it('abort mid-flight rejects kind aborted and fires one chat.abort frame with the canonical explicit session key', async () => {
    const { adapter, captured } = adapterWithHangingGateway()
    const controller = new AbortController()

    const pending = adapter.messaging.send({
      agentId: 'a1',
      content: 'work on the task',
      threadId: 'task:t1:d1',
      signal: controller.signal,
    })
    pending.catch(() => {})
    // The abort is only meaningful once the frame is actually in flight.
    await waitUntil(() => captured.some((c) => c.method === 'agent'),
      { label: 'the agent frame to reach the hanging gateway request' })
    controller.abort('task-deleted')

    expect.assertions(5)
    try {
      await pending
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError)
      expect((err as RuntimeError).kind).toBe('aborted')
    }
    const abortFrames = captured.filter((c) => c.method === 'chat.abort')
    expect(abortFrames.length).toBe(1)
    const expectedKey = `agent:a1:explicit:${openClawCliSessionId('a1', 'task:t1:d1')}`
    expect(abortFrames[0].params.sessionKey).toBe(expectedKey)
    // Pre-ack there is no runId to address — the param must be absent, not a guess.
    expect('runId' in abortFrames[0].params).toBe(false)
  })

  it('threaded sends carry BOTH sessionId and the canonical sessionKey (abort-registration workaround)', async () => {
    // sessionId alone leaves the run unregistered in the gateway's
    // chat-abort registry (OpenClaw 2026.6.11 — fixture
    // abort-explicit-session.jsonl); the sessionKey param is what makes the
    // run server-side abortable at all. Guard the send shape.
    const { adapter, captured } = adapterWithHangingGateway()
    const controller = new AbortController()
    const pending = adapter.messaging.send({
      agentId: 'a1',
      content: 'work on the task',
      threadId: 'task:t9:d1',
      signal: controller.signal,
    })
    pending.catch(() => {})
    await waitUntil(() => captured.some((c) => c.method === 'agent'),
      { label: 'the agent frame to be sent' })
    const agentFrames = captured.filter((c) => c.method === 'agent')
    expect(agentFrames.length).toBe(1)
    const cliSessionId = openClawCliSessionId('a1', 'task:t9:d1')
    expect(agentFrames[0].params.sessionId).toBe(cliSessionId)
    expect(agentFrames[0].params.sessionKey).toBe(`agent:a1:explicit:${cliSessionId}`)
    controller.abort('cleanup')
    await pending.catch(() => {})
  })

  it('abort after the accepted ack sends chat.abort with the ack exact ids and audits the server-side stop', async () => {
    const ack = { runId: 'bakin-run-123', sessionKey: 'agent:a1:explicit:sess-1', acceptedAt: 1 }
    const { adapter, captured, auditEvents } = adapterWithHangingGateway({ ack })
    const controller = new AbortController()

    const pending = adapter.messaging.send({
      agentId: 'a1',
      content: 'work on the task',
      threadId: 'task:t9:d1',
      signal: controller.signal,
    })
    pending.catch(() => {})
    await settle()
    controller.abort('task-deleted')

    expect.assertions(7)
    try {
      await pending
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError)
      expect((err as RuntimeError).kind).toBe('aborted')
    }
    await settle()
    const abortFrames = captured.filter((c) => c.method === 'chat.abort')
    expect(abortFrames.length).toBe(1)
    // The ack's pair is authoritative — NOT the guessed explicit key.
    expect(abortFrames[0].params.sessionKey).toBe(ack.sessionKey)
    expect(abortFrames[0].params.runId).toBe(ack.runId)
    const audit = auditEvents.filter((e) => e.action === 'agent-turn-abort')
    expect(audit.length).toBe(1)
    expect(audit[0].data).toMatchObject({ aborted: true, runIds: [ack.runId] })
  })

  it('unthreaded abort after the ack now aborts server-side via the ack session key', async () => {
    const ack = { runId: 'bakin-run-77', sessionKey: 'agent:a1:main', acceptedAt: 1 }
    const { adapter, captured } = adapterWithHangingGateway({ ack })
    const controller = new AbortController()

    const pending = adapter.messaging.send({ agentId: 'a1', content: 'unthreaded', signal: controller.signal })
    pending.catch(() => {})
    await settle()
    controller.abort('orphan-sweep')

    expect.assertions(3)
    try {
      await pending
    } catch (err) {
      expect((err as RuntimeError).kind).toBe('aborted')
    }
    await settle()
    const abortFrames = captured.filter((c) => c.method === 'chat.abort')
    expect(abortFrames.length).toBe(1)
    expect(abortFrames[0].params).toMatchObject({ sessionKey: ack.sessionKey, runId: ack.runId })
  })

  it('a chat.abort response with aborted:false is audited honestly', async () => {
    const ack = { runId: 'bakin-run-55', sessionKey: 'agent:a1:main', acceptedAt: 1 }
    const { adapter, auditEvents } = adapterWithHangingGateway({ ack, abortResponse: { ok: true, aborted: false, runIds: [] } })
    const controller = new AbortController()

    const pending = adapter.messaging.send({ agentId: 'a1', content: 'x', signal: controller.signal })
    pending.catch(() => {})
    await settle()
    controller.abort('task-deleted')
    await pending.catch(() => {})
    await settle()

    const audit = auditEvents.filter((e) => e.action === 'agent-turn-abort')
    expect(audit.length).toBe(1)
    expect(audit[0].data).toMatchObject({ aborted: false })
  })

  it('post-abort final (status timeout, stopReason aborted) still classifies as kind aborted', async () => {
    // Fixture shape: after chat.abort the agent RPC final settles ok with
    // status:'timeout', summary:'aborted', stopReason:'aborted' — the race
    // where the final beats the local rejection must never become a timeout
    // or a success.
    const adapter = createOpenClawRuntimeAdapter({ settings: { binaryPath: join(testHome, 'bin', 'openclaw') } })
    const controller = new AbortController()
    const fakeClient = {
      request: async (method: string) => {
        if (method === 'chat.abort') return { ok: true, aborted: true, runIds: ['r'] }
        if (method === 'agent') {
          controller.abort('task-deleted')
          return {
            runId: 'r',
            status: 'timeout',
            summary: 'aborted',
            stopReason: 'aborted',
            result: { payloads: [{ text: 'LLM request timed out.' }] },
          }
        }
        return { ok: true }
      },
    }
    ;(adapter as unknown as { openClawChatGateway: () => unknown }).openClawChatGateway = () => fakeClient

    expect.assertions(2)
    try {
      await adapter.messaging.send({ agentId: 'a1', content: 'x', threadId: 'task:t4:d1', signal: controller.signal })
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError)
      expect((err as RuntimeError).kind).toBe('aborted')
    }
  })

  it('pre-aborted signal rejects kind aborted without sending any frame', async () => {
    const { adapter, captured } = adapterWithHangingGateway()
    const controller = new AbortController()
    controller.abort('task-deleted')

    expect.assertions(3)
    try {
      await adapter.messaging.send({
        agentId: 'a1',
        content: 'never sent',
        threadId: 'task:t1:d1',
        signal: controller.signal,
      })
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError)
      expect((err as RuntimeError).kind).toBe('aborted')
    }
    expect(captured.filter((c) => c.method === 'agent').length).toBe(0)
  })

  it('unthreaded abort rejects kind aborted and skips the chat.abort frame (no session key)', async () => {
    const { adapter, captured } = adapterWithHangingGateway()
    const controller = new AbortController()

    const pending = adapter.messaging.send({ agentId: 'a1', content: 'unthreaded', signal: controller.signal })
    pending.catch(() => {})
    await waitUntil(() => captured.some((c) => c.method === 'agent'),
      { label: 'the unthreaded send to reach the gateway before the sweep aborts it' })
    controller.abort('orphan-sweep')

    expect.assertions(3)
    try {
      await pending
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError)
      expect((err as RuntimeError).kind).toBe('aborted')
    }
    expect(captured.filter((c) => c.method === 'chat.abort').length).toBe(0)
  })

  it('abort dominates a racing success frame — never returns ok for a cancelled turn (review F2)', async () => {
    const adapter = createOpenClawRuntimeAdapter({ settings: { binaryPath: join(testHome, 'bin', 'openclaw') } })
    const controller = new AbortController()
    // Gateway resolves successfully DESPITE the abort having fired — the
    // race where the final frame wins over the local abort rejection.
    const fakeClient = {
      request: async (method: string) => {
        if (method === 'agent') controller.abort('task-deleted')
        return { result: { meta: { finalAssistantVisibleText: 'finished anyway' } } }
      },
    }
    ;(adapter as unknown as { openClawChatGateway: () => unknown }).openClawChatGateway = () => fakeClient

    expect.assertions(2)
    try {
      await adapter.messaging.send({
        agentId: 'a1',
        content: 'racing turn',
        threadId: 'task:t3:d1',
        signal: controller.signal,
      })
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError)
      expect((err as RuntimeError).kind).toBe('aborted')
    }
  })

  it('natural settle with an unaborted signal returns content normally', async () => {
    const adapter = createOpenClawRuntimeAdapter({ settings: { binaryPath: join(testHome, 'bin', 'openclaw') } })
    const fakeClient = {
      request: async () => ({ result: { meta: { finalAssistantVisibleText: 'done' } } }),
    }
    ;(adapter as unknown as { openClawChatGateway: () => unknown }).openClawChatGateway = () => fakeClient
    const controller = new AbortController()
    const result = await adapter.messaging.send({
      agentId: 'a1',
      content: 'quick task',
      threadId: 'task:t2:d1',
      signal: controller.signal,
    })
    expect(result.content).toBe('done')
  })
})

describe('openClawExplicitSessionKey format pin', () => {
  it('is the single owner of the gateway canonical explicit-session key format', () => {
    // Drift here silently breaks BOTH the send-shape workaround and the
    // abort fallback (fixtures abort-sessionkey-addressed.jsonl record the
    // gateway echoing exactly this format).
    expect(openClawExplicitSessionKey('pixel', 'abc-123')).toBe('agent:pixel:explicit:abc-123')
  })
})
