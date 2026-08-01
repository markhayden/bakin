import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Isolation: the gateway module writes session-death trajectories under the
// mock home — pin every resolver to a temp dir so no path can reach ~/.bakin
// or ~/.openclaw.
const tempDir = mkdtempSync(join(tmpdir(), 'bakin-mock-gateway-streaming-'))
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
  event?: string
  payload?: Record<string, unknown>
}

/** Run one agent RPC with a frame collector, real-gateway style. */
async function runWithFrames(params: Record<string, unknown>): Promise<{ frames: Frame[]; final: { ok: boolean; payload?: unknown } }> {
  const frames: Frame[] = []
  const final = await handleGatewayRpcRequest('agent', params, {
    requestId: 'req-1',
    push: (frame) => frames.push(frame as Frame),
  })
  return { frames, final }
}

function eventPayloads(frames: Frame[], event: string): Array<Record<string, unknown>> {
  return frames
    .filter((f) => f.type === 'event' && f.event === event)
    .map((f) => f.payload ?? {})
}

describe('mock gateway agent RPC', () => {
  it('returns final agent text payloads through the Gateway RPC contract', async () => {
    const res = await handleGatewayRpcRequest('agent', {
      agentId: 'jessica',
      message: 'Plan next week',
      expectFinal: true,
    })

    expect(res.ok).toBe(true)
    const payload = res.payload as {
      result?: { payloads?: Array<{ text?: string }>; meta?: { finalAssistantVisibleText?: string } }
    }
    expect(payload.result?.payloads?.[0]?.text).toContain('mock:Jessica')
    expect(payload.result?.meta?.finalAssistantVisibleText).toContain('mock:Jessica')
  })

  it('uses the message param for echo mode replies', async () => {
    const original = process.env.OPENCLAW_MOCK_CHAT_MODE
    process.env.OPENCLAW_MOCK_CHAT_MODE = 'echo'

    try {
      const res = await handleGatewayRpcRequest('agent', {
        agentId: 'rolo',
        message: 'Plan outdoor content',
        expectFinal: true,
      })

      expect(res.ok).toBe(true)
      expect(JSON.stringify(res.payload)).toContain('[mock:Rolo] Plan outdoor content')
    } finally {
      process.env.OPENCLAW_MOCK_CHAT_MODE = original
    }
  })
})

describe('mock gateway push-event streaming', () => {
  beforeEach(() => {
    process.env.OPENCLAW_MOCK_CHAT_MODE = 'echo'
  })

  afterEach(() => {
    delete process.env.OPENCLAW_MOCK_CHAT_MODE
    resetGatewayObservations()
  })

  it('emits ack → lifecycle → chat deltas (with cumulative) → final, real-wire shaped', async () => {
    const { frames, final } = await runWithFrames({
      agentId: 'jessica',
      message: 'Stream a few deltas for the frame shape test',
      idempotencyKey: 'idem-frame-shape',
      expectFinal: true,
    })

    // Accepted ack res on the request id, BEFORE any event frame.
    const ackIndex = frames.findIndex((f) => f.type === 'res')
    expect(ackIndex).toBe(0)
    expect(frames[0]).toMatchObject({
      type: 'res',
      id: 'req-1',
      ok: true,
      payload: { status: 'accepted', runId: 'idem-frame-shape' },
    })
    expect(typeof frames[0].payload?.sessionKey).toBe('string')

    // Chat deltas: ≥2, each with deltaText AND the full cumulative text.
    const chats = eventPayloads(frames, 'chat')
    const deltas = chats.filter((c) => c.state === 'delta')
    expect(deltas.length).toBeGreaterThanOrEqual(2)
    for (const delta of deltas) {
      expect(delta.runId).toBe('idem-frame-shape')
      expect(typeof delta.deltaText).toBe('string')
      const message = delta.message as { content?: Array<{ text?: string }> }
      expect(typeof message?.content?.[0]?.text).toBe('string')
    }
    const finalChat = chats.find((c) => c.state === 'final')
    expect(finalChat).toBeDefined()

    // Deltas reassemble to the reply, and the last cumulative equals it too.
    const reply = '[mock:Jessica] Stream a few deltas for the frame shape test'
    expect(deltas.map((d) => d.deltaText).join('')).toBe(reply)

    // Lifecycle start + end around the deltas; assistant mirror frames exist
    // (they must be ignorable noise for the adapter's machine).
    const agents = eventPayloads(frames, 'agent')
    const lifecyclePhases = agents
      .filter((a) => a.stream === 'lifecycle')
      .map((a) => (a.data as { phase?: string })?.phase)
    expect(lifecyclePhases[0]).toBe('start')
    expect(lifecyclePhases.at(-1)).toBe('end')
    expect(agents.some((a) => a.stream === 'assistant')).toBe(true)

    // Broadcast noise rides along like the real wire.
    expect(frames.some((f) => f.type === 'event' && (f.event === 'health' || f.event === 'tick'))).toBe(true)

    // The final response keeps today's contract.
    expect(final.ok).toBe(true)
    expect(JSON.stringify(final.payload)).toContain(reply)
  })

  it('emits tool/item/command_output frames for a [[tool]] turn', async () => {
    const { frames } = await runWithFrames({
      agentId: 'pixel',
      message: 'List things [[tool]] and report back',
      idempotencyKey: 'idem-tool-turn',
      expectFinal: true,
    })

    const agents = eventPayloads(frames, 'agent')
    const tools = agents.filter((a) => a.stream === 'tool').map((a) => a.data as Record<string, unknown>)
    expect(tools.map((t) => t.phase)).toEqual(['start', 'result'])
    expect(tools[0]).toMatchObject({ name: 'exec', toolCallId: 'tc-1' })
    expect(tools[0].args).toBeDefined()
    expect(tools[1]).toMatchObject({ name: 'exec', toolCallId: 'tc-1', isError: false })

    // The mirroring UI-card streams are present as noise coverage.
    expect(agents.some((a) => a.stream === 'item')).toBe(true)
    expect(agents.some((a) => a.stream === 'command_output')).toBe(true)
  })

  it('skips the middle delta frame for [[dropped-delta]] but keeps cumulative complete', async () => {
    const { frames } = await runWithFrames({
      agentId: 'rolo',
      message: 'Drop one [[dropped-delta]] delta somewhere in the middle of this reply',
      idempotencyKey: 'idem-dropped',
      expectFinal: true,
    })

    const deltas = eventPayloads(frames, 'chat').filter((c) => c.state === 'delta')
    const reply = '[mock:Rolo] Drop one delta somewhere in the middle of this reply'
    // The dropped frame's text never appears as deltaText…
    expect(deltas.map((d) => d.deltaText).join('')).not.toBe(reply)
    // …but the last delta's cumulative text carries everything.
    const last = deltas.at(-1)!
    const message = last.message as { content?: Array<{ text?: string }> }
    expect(message?.content?.[0]?.text).toBe(reply)
  })

  it('chat.abort by runId cancels the run: aborted frame, {aborted:true}, post-abort final', async () => {
    process.env.OPENCLAW_MOCK_CHAT_MODE = 'slow'
    process.env.OPENCLAW_MOCK_CHAT_DELAY_MS = '10000'
    try {
      const frames: Frame[] = []
      // The fixed adapter send shape: sessionId AND its canonical sessionKey
      // (sessionId alone is the upstream-defect shape — see the
      // workaround-regressions test).
      const turn = handleGatewayRpcRequest(
        'agent',
        {
          agentId: 'patch',
          message: 'Count slowly',
          idempotencyKey: 'idem-abort',
          sessionId: 'sess-abort',
          sessionKey: 'agent:patch:explicit:sess-abort',
          expectFinal: true,
        },
        { requestId: 'req-abort', push: (frame) => frames.push(frame as Frame) },
      )
      await waitUntil(() => frames.some((f) => f.type === 'res'),
        { label: 'the ack frame to land' })
      const ack = frames.find((f) => f.type === 'res')
      expect(ack?.payload).toMatchObject({ status: 'accepted', runId: 'idem-abort' })
      const sessionKey = ack?.payload?.sessionKey as string

      const abortRes = await handleGatewayRpcRequest('chat.abort', { sessionKey, runId: 'idem-abort' })
      expect(abortRes.ok).toBe(true)
      expect(abortRes.payload).toMatchObject({ aborted: true, runIds: ['idem-abort'] })

      const final = await turn
      expect(final.ok).toBe(true)
      expect(final.payload).toMatchObject({ status: 'timeout', summary: 'aborted', stopReason: 'aborted' })

      const aborted = eventPayloads(frames, 'chat').find((c) => c.state === 'aborted')
      expect(aborted).toMatchObject({ runId: 'idem-abort' })

      // Consumed: a second abort probe finds nothing.
      const probe = await handleGatewayRpcRequest('chat.abort', { sessionKey })
      expect(probe.payload).toMatchObject({ aborted: false })
    } finally {
      delete process.env.OPENCLAW_MOCK_CHAT_MODE
      delete process.env.OPENCLAW_MOCK_CHAT_DELAY_MS
    }
  })
})
