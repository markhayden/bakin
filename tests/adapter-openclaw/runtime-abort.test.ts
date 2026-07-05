/**
 * T2 (#604): MessageArgs.signal → local reject (kind 'aborted') + best-effort
 * gateway chat.abort frame.
 *
 * Live-probe facts (OpenClaw 2026.6.11, 2026-07-05): chat.abort/sessions.abort
 * only resolve channel auto-reply runs — backend `agent` RPC runs are NOT
 * server-side abortable today. The frame is still sent (fail-open,
 * forward-compat); the local rejection is what frees Bakin's dispatch slot.
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
import { openClawCliSessionId } from '../../packages/adapter-openclaw/src/session-activity'

afterAll(() => rmSync(testHome, { recursive: true, force: true }))

type Captured = { method: string; params: Record<string, unknown> }

/**
 * Fake gateway client mirroring gateway-rpc semantics: the `agent` request
 * hangs until opts.signal aborts (local rejection, no cancel frame — exactly
 * what the real client does); every other method resolves immediately.
 */
function adapterWithHangingGateway() {
  const adapter = createOpenClawRuntimeAdapter({ settings: { binaryPath: join(testHome, 'bin', 'openclaw') } })
  const captured: Captured[] = []
  const fakeClient = {
    request: (method: string, params: Record<string, unknown>, opts?: { signal?: AbortSignal }) => {
      captured.push({ method, params })
      if (method !== 'agent') return Promise.resolve({ ok: true })
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          reject(new RuntimeError('mock gateway request aborted: agent', { kind: 'transport' }))
        }, { once: true })
      })
    },
  }
  ;(adapter as unknown as { openClawChatGateway: () => unknown }).openClawChatGateway = () => fakeClient
  return { adapter, captured }
}

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
    // Let the send reach the hanging gateway request before aborting.
    await new Promise((resolve) => setTimeout(resolve, 20))
    controller.abort('task-deleted')

    expect.assertions(4)
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
    await new Promise((resolve) => setTimeout(resolve, 20))
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
