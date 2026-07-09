/**
 * Gateway event-frame schema tests, driven by the REAL wire recordings from
 * the T1 spike (tests/fixtures/openclaw-gateway-frames/*.jsonl — OpenClaw
 * 2026.6.11, protocol 4). Every agent/chat event frame in the fixtures must
 * classify and parse; unknown/irrelevant frames must be ignored, never throw.
 */
import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-gateway-frames-${Date.now()}`)
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
}))

import {
  agentEventPayloadSchema,
  chatEventPayloadSchema,
  chatCumulativeText,
  classifyGatewayEventFrame,
  parseAgentStreamData,
  subscribeAgentEvents,
  subscribeChatEvents,
} from '../../packages/adapter-openclaw/src/gateway-frames'
import type { OpenClawGatewayEventFrame } from '../../packages/adapter-openclaw/src/gateway-rpc'

const FIXTURE_DIR = join(import.meta.dir, '../fixtures/openclaw-gateway-frames')
const FIXTURE_FILES = ['text-turn.jsonl', 'tool-turn.jsonl', 'abort-turn.jsonl'] as const

interface RecordedLine {
  ts: number
  dir: 'in' | 'out' | 'note'
  frame: Record<string, unknown>
}

function inboundEventFrames(file: string): OpenClawGatewayEventFrame[] {
  const lines = readFileSync(join(FIXTURE_DIR, file), 'utf8').trim().split('\n')
  return lines
    .map((line) => JSON.parse(line) as RecordedLine)
    .filter((entry) => entry.dir === 'in' && entry.frame.type === 'event')
    .map((entry) => entry.frame as unknown as OpenClawGatewayEventFrame)
}

describe('gateway frame schemas vs the recorded fixtures', () => {
  it('classifies and parses EVERY agent/chat event frame in all three recordings', () => {
    let agentCount = 0
    let chatCount = 0
    for (const file of FIXTURE_FILES) {
      for (const frame of inboundEventFrames(file)) {
        const classified = classifyGatewayEventFrame(frame)
        if (frame.event === 'agent') {
          expect(classified, `${file}: agent frame failed to classify: ${JSON.stringify(frame.payload)}`).not.toBeNull()
          expect(classified!.kind).toBe('agent')
          agentCount++
        } else if (frame.event === 'chat') {
          expect(classified, `${file}: chat frame failed to classify: ${JSON.stringify(frame.payload)}`).not.toBeNull()
          expect(classified!.kind).toBe('chat')
          chatCount++
        } else {
          // connect.challenge / health / tick etc. are not turn events.
          expect(classified).toBeNull()
        }
      }
    }
    // Floors from the recordings — catches silent skips if fixture parsing breaks.
    expect(agentCount).toBeGreaterThanOrEqual(20)
    expect(chatCount).toBeGreaterThanOrEqual(6)
  })

  it('every classified payload carries the runId keying field', () => {
    for (const file of FIXTURE_FILES) {
      for (const frame of inboundEventFrames(file)) {
        const classified = classifyGatewayEventFrame(frame)
        if (!classified) continue
        expect(typeof classified.payload.runId).toBe('string')
        expect(classified.payload.runId.length).toBeGreaterThan(0)
      }
    }
  })

  it('tool-turn: typed stream data covers tool/item/command_output/assistant shapes', () => {
    const streams = inboundEventFrames('tool-turn.jsonl')
      .map((frame) => classifyGatewayEventFrame(frame))
      .filter((c): c is NonNullable<typeof c> => c !== null && c.kind === 'agent')
      .map((c) => parseAgentStreamData(c.payload as never))

    const toolPhases = streams.filter((s) => s.stream === 'tool').map((s) => (s as { phase: string | null }).phase)
    expect(toolPhases).toContain('start')
    expect(toolPhases).toContain('result')

    const tool = streams.find((s) => s.stream === 'tool' && (s as { phase: string | null }).phase === 'start') as
      | { name: string | null; toolCallId: string | null }
      | undefined
    expect(tool?.name).toBe('exec')
    expect(tool?.toolCallId).toBeTruthy()

    const itemKinds = streams.filter((s) => s.stream === 'item').map((s) => (s as { kind: string | null }).kind)
    expect(itemKinds).toContain('tool')
    expect(itemKinds).toContain('command')

    const cmdEnd = streams.find(
      (s) => s.stream === 'command_output' && (s as { phase: string | null }).phase === 'end',
    ) as { output: string | null; exitCode: number | null } | undefined
    expect(cmdEnd?.output).toContain('AGENT')
    expect(cmdEnd?.exitCode).toBe(0)

    const assistant = streams.find((s) => s.stream === 'assistant') as { text: string | null; delta: string | null } | undefined
    expect(assistant?.text).toBe('DONE')
    expect(assistant?.delta).toBe('DONE')
  })

  it('abort-turn: chat states include delta and aborted; lifecycle end reports the abort', () => {
    const classified = inboundEventFrames('abort-turn.jsonl')
      .map((frame) => classifyGatewayEventFrame(frame))
      .filter((c): c is NonNullable<typeof c> => c !== null)

    const chatStates = classified.filter((c) => c.kind === 'chat').map((c) => (c.payload as { state: string }).state)
    expect(chatStates).toContain('delta')
    expect(chatStates).toContain('aborted')

    const lifecycleEnds = classified
      .filter((c) => c.kind === 'agent')
      .map((c) => parseAgentStreamData(c.payload as never))
      .filter((s) => s.stream === 'lifecycle' && (s as { phase: string | null }).phase === 'end') as Array<{
      aborted: boolean | null
    }>
    expect(lifecycleEnds.some((s) => s.aborted === true)).toBe(true)
  })

  it('chat deltas carry cumulative text (the dropIfSlow self-heal source)', () => {
    const deltas = inboundEventFrames('abort-turn.jsonl')
      .map((frame) => classifyGatewayEventFrame(frame))
      .filter((c): c is NonNullable<typeof c> => c !== null && c.kind === 'chat')
      .map((c) => c.payload as never)
      .filter((p: { state?: string }) => p.state === 'delta')

    expect(deltas.length).toBeGreaterThanOrEqual(2)
    for (const delta of deltas) {
      const cumulative = chatCumulativeText(delta)
      expect(cumulative).toBeTruthy()
      expect((cumulative as string).startsWith('1')).toBe(true)
    }
  })
})

describe('tolerant parsing of unanticipated frames', () => {
  it('unknown agent streams still parse (stream preserved, data passed through)', () => {
    const frame: OpenClawGatewayEventFrame = {
      type: 'event',
      event: 'agent',
      payload: { runId: 'r1', stream: 'compaction', data: { weird: { nested: true } } },
    }
    const classified = classifyGatewayEventFrame(frame)
    expect(classified?.kind).toBe('agent')
    const data = parseAgentStreamData(classified!.payload as never)
    expect(data.stream).toBe('other')
  })

  it('unknown chat states still parse', () => {
    const frame: OpenClawGatewayEventFrame = {
      type: 'event',
      event: 'chat',
      payload: { runId: 'r1', state: 'queued', sessionKey: 'agent:x:main' },
    }
    const classified = classifyGatewayEventFrame(frame)
    expect(classified?.kind).toBe('chat')
    expect((classified!.payload as { state: string }).state).toBe('queued')
  })

  it('garbage payloads classify to null instead of throwing', () => {
    const cases: unknown[] = [null, 42, 'nope', [], { stream: 'assistant' }, { runId: 7, stream: 'assistant' }, { runId: 'r1' }]
    for (const payload of cases) {
      expect(() => classifyGatewayEventFrame({ type: 'event', event: 'agent', payload })).not.toThrow()
      expect(classifyGatewayEventFrame({ type: 'event', event: 'agent', payload })).toBeNull()
    }
    expect(classifyGatewayEventFrame({ type: 'event', event: 'chat', payload: { state: 'delta' } })).toBeNull()
  })

  it('schemas accept extra unknown fields without stripping runId/stream/state', () => {
    const agent = agentEventPayloadSchema.safeParse({ runId: 'r', stream: 's', futureField: 1 })
    expect(agent.success).toBe(true)
    const chat = chatEventPayloadSchema.safeParse({ runId: 'r', state: 'delta', futureField: 1 })
    expect(chat.success).toBe(true)
  })
})

describe('typed subscribe helpers', () => {
  function stubSource(): {
    handlers: Map<string, (payload: unknown, frame: OpenClawGatewayEventFrame) => void>
    subscribe: (event: string, handler: (payload: unknown, frame: OpenClawGatewayEventFrame) => void) => () => void
  } {
    const handlers = new Map<string, (payload: unknown, frame: OpenClawGatewayEventFrame) => void>()
    return {
      handlers,
      subscribe(event, handler) {
        handlers.set(event, handler)
        return () => handlers.delete(event)
      },
    }
  }

  it('subscribeAgentEvents delivers parsed payloads and drops invalid ones', () => {
    const source = stubSource()
    const seen: string[] = []
    const unsubscribe = subscribeAgentEvents(source, (payload) => seen.push(payload.runId))

    const deliver = source.handlers.get('agent')!
    deliver({ runId: 'r1', stream: 'assistant', data: { text: 'x' } }, { type: 'event', event: 'agent' })
    deliver({ nope: true }, { type: 'event', event: 'agent' })
    deliver({ runId: 'r2', stream: 'lifecycle', data: { phase: 'end' } }, { type: 'event', event: 'agent' })

    expect(seen).toEqual(['r1', 'r2'])
    unsubscribe()
    expect(source.handlers.has('agent')).toBe(false)
  })

  it('subscribeChatEvents delivers parsed payloads and drops invalid ones', () => {
    const source = stubSource()
    const seen: string[] = []
    subscribeChatEvents(source, (payload) => seen.push(`${payload.runId}:${payload.state}`))

    const deliver = source.handlers.get('chat')!
    deliver({ runId: 'r1', state: 'delta', deltaText: 'hi' }, { type: 'event', event: 'chat' })
    deliver('garbage', { type: 'event', event: 'chat' })
    deliver({ runId: 'r1', state: 'final' }, { type: 'event', event: 'chat' })

    expect(seen).toEqual(['r1:delta', 'r1:final'])
  })
})
