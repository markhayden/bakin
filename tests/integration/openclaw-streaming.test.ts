/**
 * T6 (prelaunch-hardening R6) — streaming e2e: real OpenClaw adapter over the
 * Imitation Crab mock gateway's push-event frames.
 *
 * Proves the full composition CI-side without Docker: subscribe → agent RPC →
 * accepted ack (thinking) → chat deltas (incremental text, dropped-delta
 * self-heal) → agent tool frames (structured chips, no item/command_output
 * duplicates) → exactly-one done; and abort mid-turn → chat.abort lands with
 * the ack's {runId, sessionKey}, the stream ends cleanly, and the adapter's
 * agent-turn-abort audit fires.
 */
import { describe, it, expect, afterEach, afterAll, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const tempDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-streaming-'))
let mockHome = tempDir // re-pointed at the harness home once it exists

const contentDirMock = () => ({
  getContentDir: () => mockHome,
  getBakinPaths: () => ({ root: mockHome, home: mockHome, db: join(mockHome, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const openClawHomeMock = () => ({
  getOpenClawHome: () => mockHome,
  getOpenClawPath: (...parts: string[]) => join(mockHome, ...parts),
  resetOpenClawHome: () => {},
})
mock.module('@bakin/adapter-openclaw/home', openClawHomeMock)
mock.module('../../packages/adapter-openclaw/src/home', openClawHomeMock)

import { createImitationCrabHarness, type ImitationCrabHarness } from '../../dev/imitation-crab/harness'
import {
  getObservedAgentRuns,
  getObservedChatAborts,
  resetGatewayObservations,
} from '../../dev/imitation-crab/gateway'

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

import type { ChatChunk } from '../../packages/core/src/adapters/runtime'

type Chunk = ChatChunk

async function collect(stream: AsyncIterable<Chunk>): Promise<Chunk[]> {
  const chunks: Chunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function textOf(chunks: Chunk[]): string {
  return chunks.filter((c) => c.type === 'text').map((c) => c.content ?? '').join('')
}

describe('openclaw streaming over the mock gateway (e2e)', () => {
  let harness: ImitationCrabHarness | null = null

  afterEach(async () => {
    await harness?.close()
    harness = null
    resetGatewayObservations()
  })

  it('streams a chat turn: thinking first, incremental text, exactly one trailing done', async () => {
    harness = await createImitationCrabHarness({ chatMode: 'echo' })
    mockHome = harness.env.home
    const message = 'Stream this reply as several incremental deltas for the harness'

    const chunks: Chunk[] = []
    let firstTextAt: number | null = null
    for await (const chunk of harness.services.runtime.messaging.stream({
      agentId: 'jessica',
      content: message,
    })) {
      if (chunk.type === 'text' && firstTextAt === null) firstTextAt = Date.now()
      chunks.push(chunk)
    }

    expect(chunks[0]).toMatchObject({ type: 'status', content: 'thinking' })
    const doneIndexes = chunks.map((c, i) => (c.type === 'done' ? i : -1)).filter((i) => i >= 0)
    expect(doneIndexes).toEqual([chunks.length - 1])
    const textChunks = chunks.filter((c) => c.type === 'text')
    expect(textChunks.length).toBeGreaterThanOrEqual(2)
    expect(textOf(chunks)).toBe(`[mock:Jessica] ${message}`)
    expect(chunks.some((c) => c.type === 'error')).toBe(false)

    // LIVENESS, not just chunking: the consumer saw text while the turn was
    // still in flight — before the mock even sent the final RPC response. A
    // buffer-then-replay implementation would fail this.
    const run = getObservedAgentRuns().at(-1)!
    expect(firstTextAt).not.toBeNull()
    expect(typeof run.finalSentAt).toBe('number')
    expect(firstTextAt!).toBeLessThanOrEqual(run.finalSentAt!)
  })

  it('surfaces tool activity as structured tool chunks without item/command_output duplicates', async () => {
    harness = await createImitationCrabHarness({ chatMode: 'echo' })
    mockHome = harness.env.home
    const message = 'Run the listing [[tool]] then summarize what you found for me'

    const chunks = await collect(harness.services.runtime.messaging.stream({
      agentId: 'pixel',
      content: message,
    }))

    const toolChunks = chunks.filter((c) => c.type === 'tool')
    // start + result — item/command_output frames for the same call must not
    // produce extra chips.
    expect(toolChunks.length).toBe(2)
    expect(toolChunks[0].data).toMatchObject({ phase: 'call', toolName: 'exec', status: 'running' })
    expect(toolChunks[1].data).toMatchObject({ phase: 'result', toolName: 'exec' })
    expect(textOf(chunks)).toContain('[mock:Pixel]')
    expect(chunks.at(-1)?.type).toBe('done')
  })

  it('[[slow]] streams word-by-word and aborts cleanly mid-stream (the queue-showcase marker, #729)', async () => {
    harness = await createImitationCrabHarness({ chatMode: 'canned' })
    mockHome = harness.env.home

    const controller = new AbortController()
    const chunks: Chunk[] = []
    for await (const chunk of harness.services.runtime.messaging.stream({
      agentId: 'rolo',
      content: 'take your time with this one [[slow]]',
      signal: controller.signal,
    })) {
      chunks.push(chunk)
      // Word-by-word pacing gives a human-scale window — stop after a few
      // words, like an operator steering mid-reply.
      if (chunks.filter((c) => c.type === 'text').length === 4) controller.abort()
    }

    const partial = textOf(chunks)
    // Real partial text survived the Stop, and we aborted long before the end.
    expect(partial.length).toBeGreaterThan(0)
    expect(partial).toContain('[mock:Rolo]')
    expect(partial).not.toContain('wrapping up')
    // Clean abort per the runtime contract: done, never an error chunk.
    expect(chunks.some((c) => c.type === 'error')).toBe(false)
    expect(chunks.at(-1)?.type).toBe('done')
    // The marker never leaks into the reply text.
    expect(partial).not.toContain('[[slow]]')
  })

  it('self-heals a dropped delta from cumulative text', async () => {
    harness = await createImitationCrabHarness({ chatMode: 'echo' })
    mockHome = harness.env.home
    const message = 'This turn loses a middle delta [[dropped-delta]] but the text must assemble completely'

    const chunks = await collect(harness.services.runtime.messaging.stream({
      agentId: 'rolo',
      content: message,
    }))

    expect(textOf(chunks)).toBe(`[mock:Rolo] ${message.replace(' [[dropped-delta]]', '')}`)
    expect(chunks.at(-1)?.type).toBe('done')
  })

  it('abort mid-turn: chat.abort carries the ack ids, the stream ends cleanly, audit fires', async () => {
    process.env.OPENCLAW_MOCK_CHAT_DELAY_MS = '10000'
    harness = await createImitationCrabHarness({ chatMode: 'slow' })
    mockHome = harness.env.home

    // The harness adapter has no audit hook — build one that does, over the
    // same intercepted gateway.
    const { createOpenClawRuntimeAdapter } = await import('../../packages/adapter-openclaw/src')
    const audits: Array<{ action: string; data: Record<string, unknown> }> = []
    const runtime = createOpenClawRuntimeAdapter({
      settings: {
        binaryPath: harness.env.shimPath,
        gatewayUrl: 'http://127.0.0.1',
        gatewayPort: harness.env.port,
      },
    })
    await runtime.initialize({
      contentDir: harness.env.home,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      audit: (event) => audits.push({ action: event.action, data: event.data as Record<string, unknown> }),
    })

    try {
      const controller = new AbortController()
      const stream = runtime.messaging.stream({
        agentId: 'patch',
        content: 'Count slowly to fifty please',
        threadId: 'chat:abort-e2e',
        signal: controller.signal,
      })

      const chunks: Chunk[] = []
      const started = Date.now()
      for await (const chunk of stream) {
        chunks.push(chunk)
        if (chunk.type === 'status') controller.abort()
      }
      const elapsed = Date.now() - started

      // Ended from the abort, not the 10s slow delay.
      expect(elapsed).toBeLessThan(5000)
      expect(chunks[0]).toMatchObject({ type: 'status', content: 'thinking' })
      expect(chunks.at(-1)?.type).toBe('done')
      expect(chunks.some((c) => c.type === 'error')).toBe(false)

      // The mock saw chat.abort addressed by the ack's exact pair.
      const runs = getObservedAgentRuns()
      expect(runs.length).toBeGreaterThanOrEqual(1)
      const run = runs.at(-1)!
      const aborts = getObservedChatAborts()
      expect(aborts.length).toBeGreaterThanOrEqual(1)
      expect(aborts.at(-1)).toMatchObject({ runId: run.runId, sessionKey: run.sessionKey })

      // Response-checked abort audited as landed.
      const abortAudits = audits.filter((a) => a.action === 'agent-turn-abort')
      expect(abortAudits.length).toBe(1)
      expect(abortAudits[0].data).toMatchObject({ aborted: true, runId: run.runId, sessionKey: run.sessionKey })
    } finally {
      await runtime.shutdown()
      delete process.env.OPENCLAW_MOCK_CHAT_DELAY_MS
    }
  }, 15_000)
})
