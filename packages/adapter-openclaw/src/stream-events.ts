/**
 * Push-event turn streaming: the frame→chunk state machine behind
 * `messaging.stream` (SPEC prelaunch-hardening R3+R5b).
 *
 * The gateway pushes `chat` frames (cooked assistant text: deltaText + the
 * FULL cumulative text on every frame) and `agent` frames (lifecycle / tool /
 * thinking / item / command_output). This module turns those into the
 * normalized ChatChunk taxonomy:
 *
 *  - Text comes from `chat` frames ONLY (OQ2: they mirror the assistant
 *    stream 1:1 and self-heal). Reconciliation is cumulative-text based —
 *    `dropIfSlow` deltas vanish silently and per-run seq is NOT reliable
 *    (it resets across the abort boundary; gaps are silent), so seq is
 *    never consulted for correctness.
 *  - Tool chunks come from the `tool` stream only, on `start` and `result`
 *    phases (`update` would spam a chip per partial). `item` and
 *    `command_output` mirror the same activity as UI cards — emitting them
 *    too would double every chip, so they are deliberately ignored (v1).
 *  - A deliberate abort ends the stream with `done` after flushing the
 *    aborted frame's partial text — matching the clean `kind:'aborted'`
 *    settle on the send path; `error` chunks are for failures only.
 *  - The RPC final remains authoritative: `finish({kind:'ok'})` flushes any
 *    text the events never delivered (gateway dedupe replays a cached final
 *    with no events at all; the recovery ladder can surface trajectory-
 *    recovered content the same way).
 */
import type { ChatChunk, MessageUsage } from '@bakin/core/adapters/runtime'

import {
  chatCumulativeText,
  parseAgentStreamData,
  subscribeAgentEvents,
  subscribeChatEvents,
  type AgentEventPayload,
  type ChatEventPayload,
  type GatewayEventSource,
} from './gateway-frames'
import type { OpenClawGatewayAcceptedAck } from './gateway-rpc'
import {
  firstLine,
  previewUnknown,
  normalizeToolResultStatus,
  summarizeOpenClawToolCall,
  summarizeOpenClawToolPurpose,
} from './activity-summary'

/**
 * `bakin-<agent>.bakin_exec_foo` (native-MCP prefixed) → `bakin_exec_foo`.
 * Gateway `tool`-stream frames carry the MCP-qualified name; chips render the
 * bare tool. Only the `bakin-` prefix is stripped — other dotted names
 * (e.g. `browser.navigate`) are real tool ids.
 */
function bareToolName(name: string): string {
  return name.replace(/^bakin-[a-z0-9_-]+\./, '')
}

/** How one OpenClaw turn ended, from the RPC settle (or a pushed abort). */
export type OpenClawTurnFinish =
  | { kind: 'ok'; content: string | null; usage?: MessageUsage }
  | { kind: 'aborted' }
  | { kind: 'error'; errorKind: string; message?: string }

/**
 * Pure frame→chunk state machine for ONE run. Feed classified gateway event
 * payloads in; get normalized ChatChunks out. Exactly-once terminal: the
 * first of {chat aborted event, finish()} wins; everything after returns [].
 */
export class OpenClawTurnChunkMachine {
  private runId: string
  /** Assistant text already emitted downstream (cumulative reconciliation base). */
  private emitted = ''
  private done = false

  constructor(runId: string) {
    this.runId = runId
  }

  get finished(): boolean {
    return this.done
  }

  /**
   * Adopt the ack's authoritative runId. It echoes the client idempotencyKey
   * today, but the ack's value keys every pushed frame and is what
   * `chat.abort` requires — trust it over our guess.
   */
  adoptRunId(runId: string | null | undefined): void {
    if (runId) this.runId = runId
  }

  onChatEvent(payload: ChatEventPayload): ChatChunk[] {
    if (this.done || payload.runId !== this.runId) return []
    switch (payload.state) {
      case 'delta':
        return this.onDelta(payload)
      case 'final':
        return this.flushTo(chatCumulativeText(payload))
      case 'aborted':
        // Deliberate abort: flush the frame's partial cumulative text (it can
        // be AHEAD of the last delivered delta — observed live), then end
        // cleanly. No recovery ladder, no error chunk.
        return [...this.flushTo(chatCumulativeText(payload)), ...this.finish({ kind: 'aborted' })]
      case 'error':
        // Terminal classification belongs to the RPC settle: the recovery
        // ladder may still turn this into recovered content or a typed
        // diagnosis. Never end the stream on the frame alone.
        return []
      default:
        return []
    }
  }

  onAgentEvent(payload: AgentEventPayload): ChatChunk[] {
    if (this.done || payload.runId !== this.runId || payload.isHeartbeat === true) return []
    const data = parseAgentStreamData(payload)
    switch (data.stream) {
      case 'tool':
        return this.onTool(data)
      case 'thinking':
        // Already coalesced server-side (150ms/run/stream) — one status per
        // frame is the intended cadence, not spam.
        return [{ type: 'status', content: 'thinking' }]
      default:
        // assistant: text rides the cooked `chat` stream (OQ2).
        // item/command_output: UI-card mirrors of the tool stream (see module doc).
        // lifecycle: run status only — the RPC settle is authoritative.
        return []
    }
  }

  private onDelta(payload: ChatEventPayload): ChatChunk[] {
    const cumulative = chatCumulativeText(payload)
    if (payload.replace === true) {
      // Server-directed rewrite, absorbed into the same cumulative
      // reconciliation as everything else: ChatChunk consumers are
      // append-only (contract), so a rewrite can only ever surface as its
      // not-yet-emitted suffix — anything else is dropped by flushTo. On a
      // replace frame the deltaText is the full text, so it doubles as the
      // cumulative when the message body is missing.
      return this.flushTo(cumulative ?? payload.deltaText ?? null)
    }
    if (cumulative !== null) return this.flushTo(cumulative)
    // Tolerant fallback for a delta without cumulative text (never observed
    // live — every recorded frame carries it).
    if (payload.deltaText) {
      this.emitted += payload.deltaText
      return [{ type: 'text', content: payload.deltaText }]
    }
    return []
  }

  /** Emit exactly the not-yet-emitted suffix of `cumulative` (dropped-delta self-heal). */
  private flushTo(cumulative: string | null): ChatChunk[] {
    if (this.done || !cumulative || cumulative === this.emitted) return []
    if (cumulative.startsWith(this.emitted)) {
      const increment = cumulative.slice(this.emitted.length)
      this.emitted = cumulative
      return [{ type: 'text', content: increment }]
    }
    // Divergent rewrite (replace-flagged or not): append-only consumers
    // cannot rewind — trust what already rendered, drop the frame, and keep
    // `emitted` intact so frames extending the ORIGINAL text still flush.
    // This holds at finish(ok) too: a diverging authoritative final is not
    // appended (it would duplicate downstream), so the streamed transcript
    // deliberately freezes at the divergence point.
    return []
  }

  private onTool(data: Extract<ReturnType<typeof parseAgentStreamData>, { stream: 'tool' }>): ChatChunk[] {
    const name = data.name && data.name.length > 0 ? bareToolName(data.name) : 'tool'
    if (data.phase === 'start') {
      const summary = summarizeOpenClawToolPurpose(name, data.args)
      return [{
        type: 'tool',
        content: summarizeOpenClawToolCall(name, data.args),
        data: {
          phase: 'call',
          callId: data.toolCallId ?? undefined,
          toolName: name,
          status: 'running',
          ...(summary ? { summary } : {}),
          inputPreview: previewUnknown(data.args),
        },
      }]
    }
    if (data.phase === 'result') {
      const status = normalizeToolResultStatus(undefined, undefined)
      const failed = data.isError === true
      return [{
        type: 'tool',
        content: `${name} ${failed ? 'failed' : status}`,
        data: {
          phase: 'result',
          toolName: name,
          callId: data.toolCallId ?? undefined,
          status: failed ? 'failed' : status,
          ...(data.meta ? { summary: firstLine(data.meta) } : {}),
          outputPreview: previewUnknown(data.result),
        },
      }]
    }
    // `update` (partialResult) suppressed — a chip per partial is noise.
    return []
  }

  /**
   * Terminal transition — exactly once; later calls (the RPC settling after
   * a pushed abort already ended the stream) return [].
   */
  finish(outcome: OpenClawTurnFinish): ChatChunk[] {
    if (this.done) return []
    if (outcome.kind === 'ok') {
      // Flush BEFORE latching done so the resilience path (no events at all)
      // still delivers the final text. Usage rides the done chunk (parity
      // with send() — conformance-pinned) so streamed turns are meterable.
      const residual = this.flushTo(outcome.content)
      this.done = true
      return [...residual, { type: 'done', ...(outcome.usage ? { usage: outcome.usage } : {}) }]
    }
    this.done = true
    if (outcome.kind === 'aborted') return [{ type: 'done' }]
    return [{
      type: 'error',
      ...(outcome.message ? { content: outcome.message } : {}),
      data: { kind: outcome.errorKind },
    }]
  }
}

/** Handle returned by {@link tapOpenClawTurnActivity}. */
export interface OpenClawActivityTap {
  /** Wire into the turn's accepted-ack path: adopts the authoritative runId
   *  and surfaces the immediate `thinking` status. */
  onAccepted: (ack: OpenClawGatewayAcceptedAck) => void
  /** Remove the event subscription — call on every settle path. */
  unsubscribe: () => void
}

/**
 * Send-path live-activity tap (MessageArgs.onActivity, T8/D-plan-1): the
 * same frame→chunk machine as streaming, but subscribed to `agent` events
 * only and filtered to `tool`/`status` chunks — text never flows through
 * the tap (contract: prose rides `messaging.stream`). Callback exceptions
 * are contained and reported via `onCallbackError`; they never propagate
 * into frame handling or the turn itself.
 *
 * `thinking` is once-gated per turn (matching Pi's announcedThinking): the
 * gateway emits a thinking frame every ~150ms for the whole stretch, and a
 * long turn would otherwise push hundreds of identical status chunks
 * through the tap → SSE fan-out. One "thinking" is the chip signal.
 */
export function tapOpenClawTurnActivity(opts: {
  events: GatewayEventSource
  idempotencyKey: string
  onActivity: (chunk: ChatChunk) => void
  onCallbackError: (err: unknown) => void
}): OpenClawActivityTap {
  const machine = new OpenClawTurnChunkMachine(opts.idempotencyKey)
  let thinkingAnnounced = false
  const forward = (chunks: ChatChunk[]): void => {
    for (const chunk of chunks) {
      if (chunk.type !== 'tool' && chunk.type !== 'status') continue
      if (chunk.type === 'status' && chunk.content === 'thinking') {
        if (thinkingAnnounced) continue
        thinkingAnnounced = true
      }
      try {
        opts.onActivity(chunk)
      } catch (err) {
        opts.onCallbackError(err)
      }
    }
  }
  const unsubscribe = subscribeAgentEvents(opts.events, (payload) => forward(machine.onAgentEvent(payload)))
  return {
    onAccepted: (ack) => {
      machine.adoptRunId(ack.runId)
      forward([{ type: 'status', content: 'thinking' }])
    },
    unsubscribe,
  }
}

export interface OpenClawTurnStreamDeps {
  /** Live gateway connection to subscribe on (registered BEFORE the RPC is sent). */
  events: GatewayEventSource
  /** The turn's idempotency key — the runId frames will carry until the ack says otherwise. */
  idempotencyKey: string
  /** Send the agent RPC; `onAccepted` fires on the gateway's first answer. */
  run: (hooks: { onAccepted: (ack: OpenClawGatewayAcceptedAck) => void }) => Promise<{ content: string; usage?: MessageUsage }>
  /** Map a rejected RPC to a terminal outcome (kind:'aborted' → clean done). */
  classifyFailure: (err: unknown) => OpenClawTurnFinish
  /** Internal terminal-outcome tap; callback failures are contained. */
  onFinish?: (outcome: OpenClawTurnFinish) => void
}

/** Unbounded push queue bridging subscription callbacks to an async iterator. */
class ChunkQueue {
  private items: ChatChunk[] = []
  private closed = false
  private wake: (() => void) | null = null

  push(chunks: ChatChunk[]): void {
    if (this.closed || chunks.length === 0) return
    this.items.push(...chunks)
    this.wake?.()
  }

  close(): void {
    this.closed = true
    this.wake?.()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ChatChunk> {
    for (;;) {
      while (this.items.length > 0) yield this.items.shift()!
      if (this.closed) return
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
      this.wake = null
    }
  }
}

/**
 * Drive one agent turn as a live chunk stream: subscribe → send → yield
 * chunks as frames arrive → terminal from the first of {pushed abort, RPC
 * settle}. A consumer that stops early just unsubscribes — it never aborts
 * the server-side run (that's an explicit `MessageArgs.signal` action).
 */
export async function* streamOpenClawTurnChunks(deps: OpenClawTurnStreamDeps): AsyncIterable<ChatChunk> {
  const machine = new OpenClawTurnChunkMachine(deps.idempotencyKey)
  const queue = new ChunkQueue()
  const notifyFinish = (outcome: OpenClawTurnFinish, chunks: ChatChunk[]): void => {
    if (!chunks.some((chunk) => chunk.type === 'done' || chunk.type === 'error')) return
    try {
      deps.onFinish?.(outcome)
    } catch {
      // Internal observability must never affect the stream.
    }
  }
  const push = (chunks: ChatChunk[]) => {
    queue.push(chunks)
    if (machine.finished) queue.close()
  }

  const unsubscribes = [
    subscribeChatEvents(deps.events, (payload) => {
      const chunks = machine.onChatEvent(payload)
      if (payload.state === 'aborted') notifyFinish({ kind: 'aborted' }, chunks)
      push(chunks)
    }),
    subscribeAgentEvents(deps.events, (payload) => push(machine.onAgentEvent(payload))),
  ]

  const rpc = deps.run({
    onAccepted: (ack) => {
      machine.adoptRunId(ack.runId)
      if (!machine.finished) push([{ type: 'status', content: 'thinking' }])
    },
  })
  rpc.then(
    (result) => {
      const outcome = { kind: 'ok', content: result.content, usage: result.usage } as const
      const chunks = machine.finish(outcome)
      notifyFinish(outcome, chunks)
      push(chunks)
    },
    (err) => {
      const outcome = deps.classifyFailure(err)
      const chunks = machine.finish(outcome)
      notifyFinish(outcome, chunks)
      push(chunks)
    },
  )

  try {
    yield* queue
  } finally {
    for (const unsubscribe of unsubscribes) unsubscribe()
    // A pushed abort (or an early consumer break) can leave the RPC pending;
    // its later settle must never surface as an unhandled rejection.
    rpc.catch(() => {})
  }
}
