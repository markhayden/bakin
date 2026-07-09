/**
 * Push-event turn streaming (SPEC prelaunch-hardening R3+R5b, PLAN Task 4).
 *
 * The frame→chunk state machine is exercised against the REAL wire
 * recordings in tests/fixtures/openclaw-gateway-frames/ — the fixtures are
 * authoritative over any doc claim. The driver is exercised against a stub
 * event source + fake RPC.
 */
import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// The machine/driver under test are pure (frames in → chunks out), but the
// content-dir mocks are mandatory belt-and-suspenders per CLAUDE.md: nothing
// in this file may ever resolve ~/.bakin or ~/.openclaw.
const testDir = join(tmpdir(), `bakin-test-stream-events-${Date.now()}`)
const mockedContentDir = {
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
}
mock.module('../../src/core/content-dir', () => mockedContentDir)
mock.module('../../packages/core/src/content-dir', () => mockedContentDir)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import type { ChatChunk } from '@bakin/core/adapters/runtime'
import {
  OpenClawTurnChunkMachine,
  streamOpenClawTurnChunks,
  type OpenClawTurnFinish,
} from '../../packages/adapter-openclaw/src/stream-events'
import {
  classifyGatewayEventFrame,
  type AgentEventPayload,
  type ChatEventPayload,
} from '../../packages/adapter-openclaw/src/gateway-frames'
import type { OpenClawGatewayEventFrame } from '../../packages/adapter-openclaw/src/gateway-rpc'

const FIXTURES_DIR = join(import.meta.dir, '..', 'fixtures', 'openclaw-gateway-frames')

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface FixtureLine {
  dir: 'in' | 'out'
  frame: Record<string, unknown>
}

function readFixture(name: string): FixtureLine[] {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as FixtureLine)
}

/** The accepted ack + terminal RPC payload recorded for the turn. */
function fixtureRpc(lines: FixtureLine[]): { ack: Record<string, unknown>; final: Record<string, unknown> } {
  const responses = lines
    .filter((l) => l.dir === 'in' && l.frame.type === 'res')
    .map((l) => l.frame.payload as Record<string, unknown>)
    .filter((p) => p && typeof p === 'object' && 'runId' in p)
  const ack = responses.find((p) => p.status === 'accepted')!
  const final = responses.find((p) => p.status !== 'accepted' && !('aborted' in p))!
  return { ack, final }
}

function fixtureFinalText(final: Record<string, unknown>): string {
  const result = final.result as { payloads?: Array<{ text?: string }> } | undefined
  return result?.payloads?.[0]?.text ?? ''
}

/** Replay every recorded inbound event frame through the machine. */
function replayEvents(machine: OpenClawTurnChunkMachine, lines: FixtureLine[]): ChatChunk[] {
  const chunks: ChatChunk[] = []
  for (const line of lines) {
    if (line.dir !== 'in' || line.frame.type !== 'event') continue
    const classified = classifyGatewayEventFrame(line.frame as unknown as OpenClawGatewayEventFrame)
    if (!classified) continue
    if (classified.kind === 'chat') chunks.push(...machine.onChatEvent(classified.payload))
    else chunks.push(...machine.onAgentEvent(classified.payload))
  }
  return chunks
}

function joinedText(chunks: ChatChunk[]): string {
  return chunks.filter((c) => c.type === 'text').map((c) => c.content ?? '').join('')
}

function chatDelta(runId: string, deltaText: string, cumulative: string, extra: Partial<ChatEventPayload> = {}): ChatEventPayload {
  return {
    runId,
    state: 'delta',
    deltaText,
    message: { role: 'assistant', content: [{ type: 'text', text: cumulative }] },
    ...extra,
  } as ChatEventPayload
}

describe('OpenClawTurnChunkMachine — fixture replay', () => {
  it('text turn: streams the reply text and ends with exactly one done', () => {
    const lines = readFixture('text-turn.jsonl')
    const { ack, final } = fixtureRpc(lines)
    const machine = new OpenClawTurnChunkMachine(String(ack.runId))

    const streamed = replayEvents(machine, lines)
    const terminal = machine.finish({ kind: 'ok', content: fixtureFinalText(final) })
    const chunks = [...streamed, ...terminal]

    const textChunks = chunks.filter((c) => c.type === 'text')
    expect(textChunks.length).toBeGreaterThanOrEqual(1)
    // The streamed text reassembles to the recording's final text, with no
    // duplication from the RPC-final flush.
    expect(joinedText(chunks)).toBe(fixtureFinalText(final))
    const doneChunks = chunks.filter((c) => c.type === 'done')
    expect(doneChunks.length).toBe(1)
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' })
    expect(chunks.some((c) => c.type === 'error')).toBe(false)
  })

  it('tool turn: emits structured tool chunks from the tool stream only (no item/command_output duplicates)', () => {
    const lines = readFixture('tool-turn.jsonl')
    const { ack, final } = fixtureRpc(lines)
    const machine = new OpenClawTurnChunkMachine(String(ack.runId))

    const streamed = replayEvents(machine, lines)
    const chunks = [...streamed, ...machine.finish({ kind: 'ok', content: fixtureFinalText(final) })]

    const toolChunks = chunks.filter((c) => c.type === 'tool')
    // The recording has one tool call: phases start/update/result → exactly
    // call + result chunks (update suppressed; item/command_output ignored).
    expect(toolChunks.length).toBe(2)
    const call = toolChunks[0]!.data
    expect(call.phase).toBe('call')
    expect(call.toolName).toBe('exec')
    expect(call.status).toBe('running')
    expect(typeof call.callId).toBe('string')
    expect(String(call.inputPreview)).toContain('ls')
    const result = toolChunks[1]!.data
    expect(result.phase).toBe('result')
    expect(result.toolName).toBe('exec')
    expect(result.callId).toBe(call.callId)
    expect(joinedText(chunks)).toBe('DONE')
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' })
  })

  it('abort turn: flushes the aborted frame`s partial text then ends cleanly with done (no error chunk)', () => {
    const lines = readFixture('abort-turn.jsonl')
    const { ack } = fixtureRpc(lines)
    const machine = new OpenClawTurnChunkMachine(String(ack.runId))

    const chunks = replayEvents(machine, lines)

    // Deliberate abort = clean end: done, never an error chunk (matches the
    // kind:'aborted' settle on the send path).
    expect(machine.finished).toBe(true)
    expect(chunks.filter((c) => c.type === 'done').length).toBe(1)
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' })
    expect(chunks.some((c) => c.type === 'error')).toBe(false)
    // The aborted frame's cumulative text ("…40") is AHEAD of the last
    // delivered delta ("…32") in the recording — the machine must flush the
    // residual before ending.
    expect(joinedText(chunks)).toEndWith('\n40')
    // Post-abort frames (second lifecycle emitter reusing the runId with seq
    // reset to 1) and the late RPC settle produce nothing.
    expect(machine.finish({ kind: 'error', errorKind: 'timeout' })).toEqual([])
  })
})

describe('OpenClawTurnChunkMachine — synthesized scenarios', () => {
  const RUN = 'run-x'

  it('self-heals a dropped delta from the next frame`s cumulative text', () => {
    const machine = new OpenClawTurnChunkMachine(RUN)
    const first = machine.onChatEvent(chatDelta(RUN, 'AB', 'AB'))
    // seq gap: the "CD" delta was dropped (dropIfSlow); next frame carries "EF" + cumulative.
    const second = machine.onChatEvent(chatDelta(RUN, 'EF', 'ABCDEF'))
    expect(joinedText([...first, ...second])).toBe('ABCDEF')
    expect(second).toEqual([{ type: 'text', content: 'CDEF' }])
  })

  it('replace:true emits the full new text as a fresh chunk flagged for replacement', () => {
    const machine = new OpenClawTurnChunkMachine(RUN)
    machine.onChatEvent(chatDelta(RUN, 'draft one', 'draft one'))
    const replaced = machine.onChatEvent(chatDelta(RUN, 'final answer', 'final answer', { replace: true }))
    expect(replaced).toEqual([{ type: 'text', content: 'final answer', data: { replace: true } }])
    // Subsequent deltas continue from the replaced text.
    const next = machine.onChatEvent(chatDelta(RUN, '!', 'final answer!'))
    expect(next).toEqual([{ type: 'text', content: '!' }])
  })

  it('ignores frames from other runs and heartbeats', () => {
    const machine = new OpenClawTurnChunkMachine(RUN)
    expect(machine.onChatEvent(chatDelta('other-run', 'X', 'X'))).toEqual([])
    expect(machine.onAgentEvent({ runId: 'other-run', stream: 'tool', data: { phase: 'start', name: 'exec' } } as AgentEventPayload)).toEqual([])
    expect(machine.onAgentEvent({ runId: RUN, stream: 'thinking', isHeartbeat: true, data: {} } as AgentEventPayload)).toEqual([])
    expect(machine.finished).toBe(false)
  })

  it('thinking stream surfaces as a status chunk; assistant/item/command_output/lifecycle emit nothing', () => {
    const machine = new OpenClawTurnChunkMachine(RUN)
    expect(machine.onAgentEvent({ runId: RUN, stream: 'thinking', data: { text: 'hm', delta: 'hm' } } as AgentEventPayload))
      .toEqual([{ type: 'status', content: 'thinking' }])
    expect(machine.onAgentEvent({ runId: RUN, stream: 'assistant', data: { text: 'hi', delta: 'hi' } } as AgentEventPayload)).toEqual([])
    expect(machine.onAgentEvent({ runId: RUN, stream: 'item', data: { phase: 'start', kind: 'tool' } } as AgentEventPayload)).toEqual([])
    expect(machine.onAgentEvent({ runId: RUN, stream: 'command_output', data: { phase: 'delta', output: 'x' } } as AgentEventPayload)).toEqual([])
    expect(machine.onAgentEvent({ runId: RUN, stream: 'lifecycle', data: { phase: 'start' } } as AgentEventPayload)).toEqual([])
  })

  it('finish(ok) flushes text the events never delivered (dedupe-replay / lost-events resilience)', () => {
    const machine = new OpenClawTurnChunkMachine(RUN)
    expect(machine.finish({ kind: 'ok', content: 'hello' })).toEqual([
      { type: 'text', content: 'hello' },
      { type: 'done' },
    ])
  })

  it('finish(ok) emits no duplicate text when events already streamed everything', () => {
    const machine = new OpenClawTurnChunkMachine(RUN)
    machine.onChatEvent(chatDelta(RUN, 'hello', 'hello'))
    expect(machine.finish({ kind: 'ok', content: 'hello' })).toEqual([{ type: 'done' }])
  })

  it('finish(error) emits one error chunk carrying the RuntimeError kind, then nothing more', () => {
    const machine = new OpenClawTurnChunkMachine(RUN)
    const chunks = machine.finish({ kind: 'error', errorKind: 'session_died', message: 'session died' })
    expect(chunks).toEqual([{ type: 'error', content: 'session died', data: { kind: 'session_died' } }])
    expect(machine.finish({ kind: 'ok', content: 'late' })).toEqual([])
    expect(machine.onChatEvent(chatDelta(RUN, 'late', 'late'))).toEqual([])
  })

  it('adoptRunId switches filtering to the ack`s authoritative runId', () => {
    const machine = new OpenClawTurnChunkMachine('idempotency-key-guess')
    machine.adoptRunId('server-run-id')
    expect(machine.onChatEvent(chatDelta('server-run-id', 'hi', 'hi'))).toEqual([{ type: 'text', content: 'hi' }])
    expect(machine.onChatEvent(chatDelta('idempotency-key-guess', 'no', 'no'))).toEqual([])
  })
})

describe('streamOpenClawTurnChunks — driver', () => {
  type Handler = (payload: unknown, frame: OpenClawGatewayEventFrame) => void

  function stubEvents() {
    const handlers = new Map<string, Set<Handler>>()
    let unsubscribed = 0
    return {
      source: {
        subscribe(event: string, handler: Handler) {
          const set = handlers.get(event) ?? new Set()
          set.add(handler)
          handlers.set(event, set)
          return () => {
            set.delete(handler)
            unsubscribed += 1
          }
        },
      },
      emit(event: string, payload: unknown) {
        for (const handler of handlers.get(event) ?? []) {
          handler(payload, { type: 'event', event, payload } as OpenClawGatewayEventFrame)
        }
      },
      get unsubscribedCount() {
        return unsubscribed
      },
    }
  }

  const KEY = 'bakin:thread:abc'

  it('yields thinking on ack, streamed text, then done on RPC success — and unsubscribes', async () => {
    const events = stubEvents()
    const stream = streamOpenClawTurnChunks({
      events: events.source,
      idempotencyKey: KEY,
      run: async ({ onAccepted }) => {
        onAccepted({ runId: KEY, sessionKey: 'agent:main:main', acceptedAt: 1 })
        events.emit('chat', chatDelta(KEY, 'partial ', 'partial '))
        events.emit('chat', chatDelta(KEY, 'reply', 'partial reply'))
        return { content: 'partial reply' }
      },
      classifyFailure: () => ({ kind: 'error', errorKind: 'runtime_failed' }) satisfies OpenClawTurnFinish,
    })

    const chunks: ChatChunk[] = []
    for await (const chunk of stream) chunks.push(chunk)

    expect(chunks[0]).toEqual({ type: 'status', content: 'thinking' })
    expect(joinedText(chunks)).toBe('partial reply')
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' })
    expect(events.unsubscribedCount).toBe(2)
  })

  it('ends with an error chunk when the RPC fails', async () => {
    const events = stubEvents()
    const stream = streamOpenClawTurnChunks({
      events: events.source,
      idempotencyKey: KEY,
      run: async () => {
        throw new Error('boom')
      },
      classifyFailure: () => ({ kind: 'error', errorKind: 'transport', message: 'boom' }),
    })

    const chunks: ChatChunk[] = []
    for await (const chunk of stream) chunks.push(chunk)

    expect(chunks[chunks.length - 1]).toEqual({ type: 'error', content: 'boom', data: { kind: 'transport' } })
    expect(chunks.some((c) => c.type === 'done')).toBe(false)
    expect(events.unsubscribedCount).toBe(2)
  })

  it('a chat aborted event finishes the stream before the RPC settles', async () => {
    const events = stubEvents()
    let settleRpc: (() => void) | undefined
    const stream = streamOpenClawTurnChunks({
      events: events.source,
      idempotencyKey: KEY,
      run: ({ onAccepted }) => {
        onAccepted({ runId: KEY, sessionKey: 'agent:main:main', acceptedAt: 1 })
        events.emit('chat', chatDelta(KEY, '1', '1'))
        events.emit('chat', {
          runId: KEY,
          state: 'aborted',
          stopReason: 'rpc',
          message: { role: 'assistant', content: [{ type: 'text', text: '12' }] },
        })
        // RPC left pending past the abort — settled only after consumption ends.
        return new Promise((_, reject) => {
          settleRpc = () => reject(new Error('late timeout'))
        })
      },
      classifyFailure: () => ({ kind: 'error', errorKind: 'timeout' }),
    })

    const chunks: ChatChunk[] = []
    for await (const chunk of stream) chunks.push(chunk)

    expect(joinedText(chunks)).toBe('12')
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' })
    expect(chunks.some((c) => c.type === 'error')).toBe(false)
    settleRpc?.()
    await wait(1)
  })

  it('consumer break unsubscribes without aborting the turn', async () => {
    const events = stubEvents()
    let rejectRpc: ((err: Error) => void) | undefined
    const stream = streamOpenClawTurnChunks({
      events: events.source,
      idempotencyKey: KEY,
      run: ({ onAccepted }) => {
        onAccepted({ runId: KEY, sessionKey: 'agent:main:main', acceptedAt: 1 })
        return new Promise((_, reject) => {
          rejectRpc = reject
        })
      },
      classifyFailure: () => ({ kind: 'error', errorKind: 'timeout' }),
    })

    for await (const chunk of stream) {
      expect(chunk).toEqual({ type: 'status', content: 'thinking' })
      break
    }

    expect(events.unsubscribedCount).toBe(2)
    // The still-pending RPC settling later must not surface an unhandled rejection.
    rejectRpc?.(new Error('late failure'))
    await wait(1)
  })
})
