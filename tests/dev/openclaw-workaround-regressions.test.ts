import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * OpenClaw workaround-regression pins (the antfly pattern: encode the
 * upstream defect we work around, so a fix upstream fails HERE loudly and
 * the workaround can be deleted instead of fossilizing).
 *
 * Defect (OpenClaw 2026.6.11, upstream issue: openclaw#TBD-abort-registration
 * — file it and backfill the number here, in the fixtures README, and in
 * tasks/todo-prelaunch-hardening.md; see fixture
 * tests/fixtures/openclaw-gateway-frames/abort-explicit-session.jsonl for
 * the live recording): an `agent` RPC run addressed by `sessionId` alone is
 * never registered in the gateway's chat-abort registry — the accepted ack
 * omits `sessionKey`, and chat.abort / sessions.abort cannot stop the run
 * (it streams to natural completion; this caused the 2026-07-09
 * delete-didn't-abort incident). Bakin's workaround: threaded sends carry
 * BOTH `sessionId` and its canonical `sessionKey`
 * (packages/adapter-openclaw/src/runtime.ts + session-store.ts
 * openClawExplicitSessionKey).
 *
 * These pins run against the Imitation Crab mirror of the defect, so they
 * CANNOT fail on an upstream fix by themselves — the real-wire owner is the
 * dockerized-rig validation campaign, phase R7
 * (`bun run scripts/instance/validate.ts`): run it after every OpenClaw
 * version bump. If R7.2 reports the defect is gone, re-record the fixtures
 * (scripts/instance/abort-ladder-probe.ts / abort-workaround-probe.ts) and
 * delete the mock mirror + these pins + (optionally) the send-shape
 * workaround.
 */
const tempDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-workarounds-'))
process.env.OPENCLAW_MOCK_HOME = tempDir

const contentDirMock = () => ({
  getContentDir: () => tempDir,
  getBakinPaths: () => ({ root: tempDir, home: tempDir, db: join(tempDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { handleGatewayRpcRequest, resetGatewayObservations } from '../../dev/imitation-crab/gateway'
import { waitUntil } from '../helpers/wait'

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

type Frame = Record<string, unknown> & {
  type?: string
  id?: string
  payload?: Record<string, unknown>
}

describe('openclaw 2026.6.11 workaround regressions', () => {
  beforeEach(() => {
    resetGatewayObservations()
  })

  it('sessionId-only runs are unregistered: bare ack, chat.abort cannot stop them', async () => {
    process.env.OPENCLAW_MOCK_CHAT_MODE = 'slow'
    process.env.OPENCLAW_MOCK_CHAT_DELAY_MS = '400'
    try {
      const frames: Frame[] = []
      const turn = handleGatewayRpcRequest(
        'agent',
        {
          agentId: 'patch',
          message: 'Count slowly',
          idempotencyKey: 'idem-defect-pin',
          sessionId: 'sess-defect-pin',
          expectFinal: true,
        },
        { requestId: 'req-defect', push: (frame) => frames.push(frame as Frame) },
      )
      await waitUntil(() => frames.some((f) => f.type === 'res'),
        { label: 'the ack frame to land' })

      // The ack omits sessionKey — the run was never abort-registered.
      const ack = frames.find((f) => f.type === 'res')
      expect(ack?.payload).toMatchObject({ status: 'accepted', runId: 'idem-defect-pin' })
      expect(ack?.payload && 'sessionKey' in ack.payload).toBe(false)

      // chat.abort by runId AND by the canonical explicit key both miss.
      const abortRes = await handleGatewayRpcRequest('chat.abort', {
        sessionKey: 'agent:patch:explicit:sess-defect-pin',
        runId: 'idem-defect-pin',
      })
      expect(abortRes.ok).toBe(true)
      expect(abortRes.payload).toMatchObject({ aborted: false, runIds: [] })

      // The run survives the abort attempt and completes naturally.
      const final = await turn
      expect(final.ok).toBe(true)
      expect((final.payload as Record<string, unknown>)?.status).toBe('ok')
    } finally {
      delete process.env.OPENCLAW_MOCK_CHAT_MODE
      delete process.env.OPENCLAW_MOCK_CHAT_DELAY_MS
    }
  })

  it('the workaround shape (sessionId + sessionKey) IS registered and abortable', async () => {
    process.env.OPENCLAW_MOCK_CHAT_MODE = 'slow'
    process.env.OPENCLAW_MOCK_CHAT_DELAY_MS = '2000'
    try {
      const frames: Frame[] = []
      const turn = handleGatewayRpcRequest(
        'agent',
        {
          agentId: 'patch',
          message: 'Count slowly',
          idempotencyKey: 'idem-workaround-pin',
          sessionId: 'sess-workaround-pin',
          sessionKey: 'agent:patch:explicit:sess-workaround-pin',
          expectFinal: true,
        },
        { requestId: 'req-workaround', push: (frame) => frames.push(frame as Frame) },
      )
      await waitUntil(() => frames.some((f) => f.type === 'res'),
        { label: 'the ack frame to land' })

      const ack = frames.find((f) => f.type === 'res')
      expect(ack?.payload).toMatchObject({
        status: 'accepted',
        runId: 'idem-workaround-pin',
        sessionKey: 'agent:patch:explicit:sess-workaround-pin',
      })

      const abortRes = await handleGatewayRpcRequest('chat.abort', {
        sessionKey: 'agent:patch:explicit:sess-workaround-pin',
        runId: 'idem-workaround-pin',
      })
      expect(abortRes.payload).toMatchObject({ aborted: true, runIds: ['idem-workaround-pin'] })

      const final = await turn
      expect(final.payload).toMatchObject({ status: 'timeout', summary: 'aborted', stopReason: 'aborted' })
    } finally {
      delete process.env.OPENCLAW_MOCK_CHAT_MODE
      delete process.env.OPENCLAW_MOCK_CHAT_DELAY_MS
    }
  })
})
