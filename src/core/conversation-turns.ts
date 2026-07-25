/**
 * Conversation turn service — ONE background turn engine for every
 * conversational surface (chat, embedded brainstorms).
 *
 * Generalized from the chat plugin's stream bridge (#703): a turn runs
 * server-side, detached from any HTTP request. Flow per turn: append the
 * user row → run runtime.messaging.stream() under the consumer's threadId →
 * per chunk: emit the consumer's chunk event on the plugin-event bus
 * (→ global SSE bus) and persist settled rows incrementally through the
 * kit's turn recorder. The consumer's done/error events close the turn —
 * done carries agentId + a reply preview for attention systems. One
 * in-flight turn per thread key; send routes return 202 (busy → 409) and
 * browsers follow along over the shared bus, so navigation never kills a
 * turn.
 *
 * Load-bearing semantics preserved from the bridge (chat-UX-observable —
 * see tasks/plan-703-conversation-durability.md before changing ANY of
 * these): synchronous slot reservation (TOCTOU); per-chunk drain
 * persistence (a crash keeps the partial turn); persistence never throws
 * into the turn (thread deleted mid-turn: log + continue); user-row append
 * failure releases the slot and reports not_found; attachment-only sends
 * carry a visible placeholder; only text|tool|status chunks ride the chunk
 * event; typed error kinds survive to the durable row and the error event;
 * abort ends clean with an `aborted` marker row + done flag; metering runs
 * for success AND abort (never error), with whatever usage arrived; the
 * slot releases BEFORE onSettled chains (holding it 409'd quick
 * follow-ups); waitFor() called mid-turn also covers the onSettled tail.
 */
import { randomUUID } from 'crypto'

import type { PluginContext } from '@bakin/core/plugin-types'
import type { ChatChunk, MessageUsage } from '@bakin/core/adapters/runtime'
// Media downscale is imported LAZILY at attachment-prepare time: this module
// rides into the published SDK testing bundle (harness ctx.conversations),
// and a static import would pull the sharp loader's module graph into the
// npm package's declaration dependency graph.
import type { PreparedAttachment } from '@bakin/core/media/downscale'

import { createTurnRecorder } from '../components/conversation/turn-recorder'
import { createLogger } from './logger'

const log = createLogger('conversation-turns')

const PREVIEW_MAX = 140

/** The engine needs only messaging + the event bus from a plugin context. */
export type TurnContext = Pick<PluginContext, 'runtime' | 'events'>

export interface TurnAttachment {
  name: string
  mimeType: string
  path: string
}

/**
 * The durable transcript row shape (identical to chat's schema-v2 rows —
 * user attachments are path-addressed server-side; display URLs are a
 * client concern).
 */
export type ConversationTurnRow =
  | { kind: 'user'; ts: string; content: string; attachments?: TurnAttachment[] }
  | { kind: 'assistant'; ts: string; turnId?: string; content: string }
  | {
      kind: 'tool'
      ts: string
      turnId?: string
      callId?: string
      toolName: string
      status: 'completed' | 'failed'
      summary?: string
      inputPreview?: string
      outputPreview?: string
      durationMs?: number
      metadata?: Record<string, unknown>
    }
  | { kind: 'error'; ts: string; turnId?: string; message: string; errorKind?: string }
  | { kind: 'aborted'; ts: string; turnId?: string }

export interface TurnOutcome {
  aborted: boolean
  errored: boolean
}

export type StartTurnResult = 'accepted' | 'not_found' | 'busy'

export interface InflightTurnInfo {
  key: string
  agentId: string
  turnId: string
  startedAt: number
}

export interface ConversationTurnServiceConfig {
  /** Consumer label for log lines (e.g. 'chat', 'projects.brainstorm'). */
  name: string
  /** Bus event names — the consumer's wire contract (e.g. chat.chunk/done/error).
   *  `started` (optional) fires at turn-accept, BEFORE any runtime chunk —
   *  attention providers light the working dot instantly instead of waiting
   *  out model latency for the first chunk (#707). */
  events: { chunk: string; done: string; error: string; started?: string }
  /** Base payload identifying the thread on every event (e.g. key => ({ chatId: key })). */
  payload: (key: string) => Record<string, unknown>
  /** Resolve the thread's agent; null → start() returns 'not_found'. */
  resolveThread: (key: string) => { agentId: string } | null | Promise<{ agentId: string } | null>
  /** Append one durable transcript row. Failures are logged, never thrown into the turn. */
  appendRow: (key: string, row: ConversationTurnRow) => void | Promise<void>
  /**
   * Runtime session thread id (e.g. key => `chat:${key}`). Called once per
   * turn — per-turn thread schemes (brands' ephemeral randomUUID threads)
   * are legitimate.
   */
  threadId: (key: string, agentId: string) => string
  /** Per-turn delivery framing appended to the runtime content; never persisted. */
  framing?: string
  /** Run turns as ephemeral runtime sessions (no provider-side accumulation). */
  ephemeral?: boolean
  hooks?: {
    /** Read-only tap on EVERY runtime chunk (e.g. messaging proposal parsing). */
    onChunk?: (key: string, chunk: ChatChunk) => void
    /** Spend attribution, once per turn — success and abort, never error. */
    meter?: (info: { key: string; agentId: string; turnId: string; usage?: MessageUsage }) => Promise<void> | void
    /**
     * Success/abort path only, AFTER final row persistence but BEFORE the
     * done event — finalize derived state (e.g. messaging's proposal
     * linking) so it is durable when clients react to done. Errors are
     * logged, never thrown into the turn.
     */
    onTurnComplete?: (info: { key: string; aborted: boolean }) => Promise<void> | void
    /** Runs after the slot releases; waitFor() resolves after it completes. */
    onSettled?: (info: { ctx: TurnContext; key: string; outcome: TurnOutcome }) => Promise<unknown> | unknown
  }
}

export interface StartTurnOptions {
  attachments?: TurnAttachment[]
  /** Per-turn agent override (surfaces with an agent picker); default = resolveThread's. */
  agentId?: string
  /**
   * Pre-assembled runtime content for THIS turn (embedded surfaces inject
   * doc/context prompts here). The persisted user row always keeps the
   * clean `content`; when omitted, the runtime gets content + framing.
   */
  runtimeContent?: string
}

export interface ConversationTurnService {
  start(ctx: TurnContext, key: string, content: string, opts?: StartTurnOptions): Promise<StartTurnResult>
  /** Abort the in-flight turn; false when the thread is idle. */
  abort(key: string): boolean
  isInFlight(key: string): boolean
  /** Assistant text streamed so far for the in-flight turn (null when idle) —
   *  lets GET responses seed mid-turn rehydration without the missing-start gap. */
  inflightPreview(key: string): string | null
  /**
   * Await the current turn; when called while the turn is in flight this
   * also covers its onSettled tail. Resolves immediately when idle
   * (including during onSettled itself — the slot has already released).
   */
  waitFor(key: string): Promise<void>
  /** Every in-flight turn — consumers build active-turn resolution on top. */
  listInFlight(): InflightTurnInfo[]
}

/** Carries an error chunk's typed RuntimeError kind through the throw. */
class StreamTurnError extends Error {
  constructor(
    message: string,
    readonly kind?: string,
  ) {
    super(message)
  }
}

interface InflightTurn {
  promise: Promise<unknown>
  controller: AbortController
  agentId: string
  startedAt: number
  turnId: string
  /** Assistant text streamed so far — the recorder buffers unflushed text,
   *  so this is what a mid-turn rehydration would otherwise miss. */
  livePreview: string
}

export function createConversationTurnService(config: ConversationTurnServiceConfig): ConversationTurnService {
  // One in-flight turn per thread key. The promise is retained so callers
  // (tests, delete flows) can await settlement; routes never block on it.
  const inflight = new Map<string, InflightTurn>()

  const start = async (
    ctx: TurnContext,
    key: string,
    content: string,
    opts?: StartTurnOptions,
  ): Promise<StartTurnResult> => {
    const thread = await config.resolveThread(key)
    if (!thread) return 'not_found'
    if (inflight.has(key)) return 'busy'

    const attachments = opts?.attachments
    const agentId = (opts?.agentId ?? thread.agentId).trim()
    // A thread that resolves without an agent AND no per-turn override has
    // nowhere to run — fail before reserving the slot or persisting rows.
    if (!agentId) return 'not_found'

    // Reserve the slot SYNCHRONOUSLY — checking then awaiting before setting
    // let two concurrent sends both pass the busy guard (review TOCTOU).
    const controller = new AbortController()
    const turnId = randomUUID()
    const entry: InflightTurn = {
      promise: Promise.resolve(),
      controller,
      agentId,
      startedAt: Date.now(),
      turnId,
      livePreview: '',
    }
    inflight.set(key, entry)

    // Attachment-only sends carry a visible placeholder — the transcript
    // shows exactly what the runtime was asked.
    if (!content.trim() && attachments?.length) content = 'See the attached image.'

    try {
      await config.appendRow(key, {
        kind: 'user',
        ts: new Date().toISOString(),
        content,
        ...(attachments?.length ? { attachments } : {}),
      })
    } catch (err) {
      inflight.delete(key)
      log.error(`[${config.name}] user row append failed for ${key}`, err as Error)
      return 'not_found'
    }

    // Accept signal for attention surfaces — the first runtime chunk can be
    // seconds away (model latency), and the working dot must not wait it out.
    if (config.events.started) {
      ctx.events.emit(config.events.started, { ...config.payload(key), agentId })
    }

    // The busy slot releases when the TURN settles; onSettled work (e.g.
    // chat auto-titling) chains after release so it never holds the slot
    // through an LLM round-trip — but stays on the retained promise so
    // waitFor() covers it.
    entry.promise = runTurn(config, ctx, key, agentId, content, controller, turnId, inflight, attachments, opts?.runtimeContent)
      .finally(() => {
        inflight.delete(key)
      })
      .then(async (outcome) => {
        // Same never-throw contract as every other hook: a consumer's
        // throwing onSettled must not become an unhandled rejection (or
        // rethrow out of waitFor).
        try {
          await config.hooks?.onSettled?.({ ctx, key, outcome })
        } catch (err) {
          log.error(`[${config.name}] onSettled hook failed for ${key}`, err as Error)
        }
      })
    return 'accepted'
  }

  return {
    start,
    abort: (key) => {
      const turn = inflight.get(key)
      if (!turn) return false
      turn.controller.abort()
      return true
    },
    isInFlight: (key) => inflight.has(key),
    inflightPreview: (key) => inflight.get(key)?.livePreview ?? null,
    waitFor: async (key) => {
      await (inflight.get(key)?.promise ?? Promise.resolve())
    },
    listInFlight: () =>
      [...inflight.entries()].map(([key, t]) => ({
        key,
        agentId: t.agentId,
        turnId: t.turnId,
        startedAt: t.startedAt,
      })),
  }
}

async function runTurn(
  config: ConversationTurnServiceConfig,
  ctx: TurnContext,
  key: string,
  agentId: string,
  content: string,
  controller: AbortController,
  turnId: string,
  inflightRef: Map<string, InflightTurn>,
  attachments?: TurnAttachment[],
  runtimeContent?: string,
): Promise<TurnOutcome> {
  const recorder = createTurnRecorder({ turnId })
  let assistantText = ''
  let doneUsage: MessageUsage | undefined
  // Oversized images downscale to temp JPEGs (the shared 2 MB inline-cap
  // shim); prepared temp files are cleaned after the turn settles.
  const prepared: PreparedAttachment[] = []
  let cleanupPrepared: ((p: PreparedAttachment) => void) | undefined

  const persist = async (rows: ConversationTurnRow[]) => {
    for (const row of rows) {
      try {
        await config.appendRow(key, row)
      } catch (err) {
        // Thread deleted mid-turn: nothing durable left to write — the bus
        // already carried the content to any open UI.
        log.error(`[${config.name}] transcript append failed for ${key}`, err as Error)
      }
    }
  }

  const tap = (chunk: ChatChunk) => {
    try {
      config.hooks?.onChunk?.(key, chunk)
    } catch (err) {
      log.error(`[${config.name}] onChunk hook failed for ${key}`, err as Error)
    }
  }

  try {
    if (attachments?.length) {
      const media = await import('@bakin/core/media/downscale')
      cleanupPrepared = media.cleanupPreparedAttachment
      for (const a of attachments) {
        prepared.push(await media.prepareImageAttachment(a.path, a.mimeType))
      }
    }
    for await (const chunk of ctx.runtime.messaging.stream({
      agentId,
      content: runtimeContent ?? (config.framing ? `${content}\n\n${config.framing}` : content),
      threadId: config.threadId(key, agentId),
      signal: controller.signal,
      ...(config.ephemeral ? { ephemeral: true } : {}),
      ...(prepared.length
        ? { attachments: prepared.map((a) => ({ path: a.path, mimeType: a.mimeType })) }
        : {}),
    })) {
      tap(chunk)
      // Only liveness chunks ride the chunk event — done/error have the
      // dedicated done/error events, and consumer wire contracts (chat's
      // declared ChatChunkEvent union) depend on exactly this split.
      if (chunk.type === 'text' || chunk.type === 'tool' || chunk.type === 'status') {
        ctx.events.emit(config.events.chunk, {
          ...config.payload(key),
          agentId,
          chunk: {
            type: chunk.type,
            content: chunk.content,
            data: chunk.data,
            ...(chunk.type === 'text' && chunk.format ? { format: chunk.format } : {}),
          },
        })
      }

      if (chunk.type === 'error') {
        const kind = typeof chunk.data?.kind === 'string' ? chunk.data.kind : undefined
        throw new StreamTurnError(chunk.content || 'runtime stream error', kind)
      }

      if (chunk.type === 'text') {
        assistantText += chunk.content
        const entry = inflightRef.get(key)
        if (entry) entry.livePreview = assistantText
      }
      if (chunk.type === 'done') doneUsage = chunk.usage
      recorder.ingest(chunk)
      // Persist rows as they settle so a crash keeps the partial turn.
      await persist(recorder.drain() as ConversationTurnRow[])
    }

    await persist(recorder.finish() as ConversationTurnRow[])
    const aborted = controller.signal.aborted
    if (aborted) {
      await persist([{ kind: 'aborted', ts: new Date().toISOString(), turnId }])
    }
    try {
      await config.hooks?.onTurnComplete?.({ key, aborted })
    } catch (err) {
      log.error(`[${config.name}] onTurnComplete hook failed for ${key}`, err as Error)
    }
    // Attribute the turn's spend — aborted turns billed whatever usage
    // arrived. A usage-less done still records the run (tokens unknown,
    // never a fabricated zero). Never throws into the turn path.
    try {
      await config.hooks?.meter?.({ key, agentId, turnId, usage: doneUsage })
    } catch (err) {
      log.error(`[${config.name}] metering failed for ${key}`, err as Error)
    }
    ctx.events.emit(config.events.done, {
      ...config.payload(key),
      agentId,
      ...(assistantText ? { preview: firstLine(assistantText) } : {}),
      ...(aborted ? { aborted: true } : {}),
    })
    return { aborted, errored: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // The typed kind the adapter attached to its error chunk survives to
    // both the durable row and the bus event (never re-parsed from text).
    const kind = err instanceof StreamTurnError ? err.kind : undefined
    log.error(`[${config.name}] turn failed for ${key}`, err as Error)
    // Keep whatever streamed before the failure, then record the failure
    // honestly as its own row.
    await persist(recorder.finish() as ConversationTurnRow[])
    await persist([
      { kind: 'error', ts: new Date().toISOString(), turnId, message, ...(kind ? { errorKind: kind } : {}) },
    ])
    try {
      ctx.events.emit(config.events.error, { ...config.payload(key), agentId, message, ...(kind ? { kind } : {}) })
    } catch (emitErr) {
      // A consumer payload()/emit throw must not reject the turn promise.
      log.error(`[${config.name}] error-event emit failed for ${key}`, emitErr as Error)
    }
    return { aborted: false, errored: true }
  } finally {
    for (const p of prepared) cleanupPrepared?.(p)
  }
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.slice(0, PREVIEW_MAX) ?? ''
}
