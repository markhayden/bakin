/**
 * Typed views over the gateway's pushed event frames (`agent` + `chat`),
 * shaped by the REAL wire recordings in tests/fixtures/openclaw-gateway-frames/
 * (OpenClaw 2026.6.11, protocol 4). Parsing is deliberately tolerant: unknown
 * streams/states/fields pass through, garbage classifies to null — a protocol
 * addition must never crash a live stream.
 *
 * Live-verified facts this module encodes (SPEC prelaunch-hardening, OQ2):
 *  - `chat` frames alone carry streaming text: `deltaText` plus the FULL
 *    cumulative text on every delta (the dropIfSlow self-heal source).
 *  - `agent` frames carry lifecycle/tool/item/command_output activity; only
 *    the `tool` stream is caps-gated (`caps: ["tool-events"]` at connect).
 *  - Per-run `seq` is NOT monotonic across an abort boundary; gaps are silent
 *    (no synthetic seq-gap error frames) — treat seq as advisory only.
 */
import { z } from 'zod'

import type { OpenClawGatewayEventFrame } from './gateway-rpc'

export const agentEventPayloadSchema = z
  .looseObject({
    runId: z.string().min(1),
    stream: z.string(),
    sessionKey: z.string().optional(),
    sessionId: z.string().optional(),
    agentId: z.string().optional(),
    spawnedBy: z.string().optional(),
    isHeartbeat: z.boolean().optional(),
    seq: z.number().optional(),
    ts: z.number().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })

export type AgentEventPayload = z.infer<typeof agentEventPayloadSchema>

export const chatEventPayloadSchema = z
  .looseObject({
    runId: z.string().min(1),
    state: z.string(),
    sessionKey: z.string().optional(),
    seq: z.number().optional(),
    deltaText: z.string().optional(),
    replace: z.boolean().optional(),
    stopReason: z.string().nullish(),
    errorMessage: z.string().optional(),
    message: z
      .looseObject({
        role: z.string().optional(),
        content: z.array(z.looseObject({ type: z.string().optional(), text: z.string().optional() })).optional(),
      })
      .optional(),
  })

export type ChatEventPayload = z.infer<typeof chatEventPayloadSchema>

export type ClassifiedGatewayEvent =
  | { kind: 'agent'; payload: AgentEventPayload }
  | { kind: 'chat'; payload: ChatEventPayload }

/**
 * Classify an inbound gateway event frame into a typed turn event, or null
 * for anything irrelevant (health/tick/connect.challenge/…) or malformed.
 */
export function classifyGatewayEventFrame(frame: OpenClawGatewayEventFrame): ClassifiedGatewayEvent | null {
  if (frame.event === 'agent') {
    const result = agentEventPayloadSchema.safeParse(frame.payload)
    return result.success ? { kind: 'agent', payload: result.data } : null
  }
  if (frame.event === 'chat') {
    const result = chatEventPayloadSchema.safeParse(frame.payload)
    return result.success ? { kind: 'chat', payload: result.data } : null
  }
  return null
}

/** Full cumulative assistant text carried on every chat delta/final (joined text parts). */
export function chatCumulativeText(payload: ChatEventPayload): string | null {
  const parts = payload.message?.content
  if (!Array.isArray(parts)) return null
  const texts = parts.map((part) => part.text).filter((text): text is string => typeof text === 'string')
  return texts.length > 0 ? texts.join('') : null
}

/** Typed per-stream view of an agent event's `data` (streams observed live). */
export type AgentStreamData =
  | { stream: 'assistant' | 'thinking'; text: string | null; delta: string | null }
  | {
      stream: 'lifecycle'
      phase: string | null
      status: string | null
      stopReason: string | null
      aborted: boolean | null
      startedAt: number | null
      endedAt: number | null
    }
  | {
      stream: 'tool'
      phase: string | null
      name: string | null
      toolCallId: string | null
      meta: string | null
      args: Record<string, unknown> | null
      partialResult: unknown
      result: unknown
      isError: boolean | null
    }
  | {
      stream: 'item'
      itemId: string | null
      phase: string | null
      kind: string | null
      title: string | null
      status: string | null
      name: string | null
      toolCallId: string | null
    }
  | {
      stream: 'command_output'
      itemId: string | null
      phase: string | null
      output: string | null
      exitCode: number | null
      durationMs: number | null
      toolCallId: string | null
    }
  | { stream: 'error'; reason: string | null }
  | { stream: 'other'; rawStream: string; data: Record<string, unknown> }

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}
function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}
function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Defensive extraction of the per-stream data shapes; unknown streams → 'other'. */
export function parseAgentStreamData(payload: AgentEventPayload): AgentStreamData {
  const data = payload.data ?? {}
  switch (payload.stream) {
    case 'assistant':
    case 'thinking':
      return { stream: payload.stream, text: str(data.text), delta: str(data.delta) }
    case 'lifecycle':
      return {
        stream: 'lifecycle',
        phase: str(data.phase),
        status: str(data.status),
        stopReason: str(data.stopReason),
        aborted: bool(data.aborted),
        startedAt: num(data.startedAt),
        endedAt: num(data.endedAt),
      }
    case 'tool':
      return {
        stream: 'tool',
        phase: str(data.phase),
        name: str(data.name),
        toolCallId: str(data.toolCallId),
        meta: str(data.meta),
        args: rec(data.args),
        partialResult: data.partialResult,
        result: data.result,
        isError: bool(data.isError),
      }
    case 'item':
      return {
        stream: 'item',
        itemId: str(data.itemId),
        phase: str(data.phase),
        kind: str(data.kind),
        title: str(data.title),
        status: str(data.status),
        name: str(data.name),
        toolCallId: str(data.toolCallId),
      }
    case 'command_output':
      return {
        stream: 'command_output',
        itemId: str(data.itemId),
        phase: str(data.phase),
        output: str(data.output),
        exitCode: num(data.exitCode),
        durationMs: num(data.durationMs),
        toolCallId: str(data.toolCallId),
      }
    case 'error':
      return { stream: 'error', reason: str(data.reason) ?? str(data.message) }
    default:
      return { stream: 'other', rawStream: payload.stream, data }
  }
}

/** Minimal event source — the RPC client satisfies this; tests use stubs. */
export interface GatewayEventSource {
  subscribe(event: string, handler: (payload: unknown, frame: OpenClawGatewayEventFrame) => void): () => void
}

/** Subscribe to `agent` event frames, delivering only payloads that parse. */
export function subscribeAgentEvents(source: GatewayEventSource, handler: (payload: AgentEventPayload) => void): () => void {
  return source.subscribe('agent', (payload) => {
    const result = agentEventPayloadSchema.safeParse(payload)
    if (result.success) handler(result.data)
  })
}

/** Subscribe to `chat` event frames, delivering only payloads that parse. */
export function subscribeChatEvents(source: GatewayEventSource, handler: (payload: ChatEventPayload) => void): () => void {
  return source.subscribe('chat', (payload) => {
    const result = chatEventPayloadSchema.safeParse(payload)
    if (result.success) handler(result.data)
  })
}
