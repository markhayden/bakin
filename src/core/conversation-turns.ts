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
import type { ChatChunk, MessageUsage, RuntimeToolAccess } from '@bakin/core/adapters/runtime'
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

/** The model-attachment lane is raster-only (the #669 SVG-poisoning guard);
 * everything else rides the file lane as a path note. */
const RASTER_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export function isRasterAttachment(a: TurnAttachment): boolean {
  return RASTER_IMAGE_TYPES.has(a.mimeType)
}

/**
 * THE file-lane note generator (#742) — every chat-like surface (web
 * composer, Discord inbound) converges here; never hand-roll this note.
 * PDFs point at the blessed pdf tool rendered in the active runtime's
 * calling style; other files get the generic file-tools wording.
 */
export function fileLaneNote(a: TurnAttachment, agentId: string, renderCall?: (tool: string, args: string) => string): string {
  const isPdf = a.mimeType === 'application/pdf' || a.name.toLowerCase().endsWith('.pdf')
  if (isPdf) {
    const call = renderCall?.('bakin_exec_pdf_read', `path=${a.path}`) ?? `bakin_exec_pdf_read path=${a.path}`
    return `[file ${a.name} saved at ${a.path} — inspect it with \`${call}\`]`
  }
  return `[file ${a.name} saved at ${a.path} — open it with your file tools]`
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
  | { kind: 'done'; ts: string; turnId?: string }

export interface TurnOutcome {
  aborted: boolean
  errored: boolean
}

export type StartTurnResult = 'accepted' | 'not_found' | 'busy' | QueuedStart

/**
 * The queued acceptance (#729) — captured synchronously at push time so
 * callers get THEIR item's id, never a tail re-read that a concurrent
 * enqueue could poison (review finding: the awaited persist can park
 * behind streaming transcript writes, making post-await reads stale).
 */
export interface QueuedStart {
  queued: true
  queueId: string
  queueLength: number
}

/**
 * A message accepted while the slot was busy (#729). Queued messages are a
 * consumer-durable snapshot (the `queue.persist` hook) and drain as ONE
 * combined turn when the active turn settles — done, error, and abort all
 * drain. `agentId` is the agent resolved at enqueue time; the drain's
 * synchronous slot reservation uses it, then refreshes from resolveThread
 * before the runtime call.
 */
export interface QueuedMessage {
  id: string
  ts: string
  content: string
  agentId: string
  attachments?: TurnAttachment[]
}

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
  /**
   * Persist an invisible `{kind:'done'}` marker row at clean success settle
   * (#735). Abort/error settles already end on their own terminal rows, so
   * with this on EVERY settled turn ends on a terminal row — the evidence a
   * boot sweep needs to stamp partial-output deaths without ever falsely
   * marking a completed turn. Chat-style sweepable transcripts only:
   * bounded stores (brands' 300-row brainstorm array) would evict real
   * rows, and foreign zod schemas would reject the kind.
   */
  terminalMarkerRows?: boolean
  /**
   * Opt-in pending queue (#729). Without this, a busy slot always answers
   * `'busy'` — strict surfaces are unchanged.
   */
  queue?: {
    /**
     * Full-snapshot persistence after every queue mutation — the restart
     * durability promise. Failures are logged, never thrown to callers.
     */
    persist?: (key: string, items: QueuedMessage[]) => void | Promise<void>
    /** Bus event emitted on enqueue (payload + queueId + queueLength). */
    event?: string
  }
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
   * Busy slot → enqueue instead of `'busy'` (requires `config.queue`).
   * The busy-check and enqueue happen in one synchronous block (no TOCTOU).
   * CAVEAT: a QUEUED send keeps only content + attachments — a per-turn
   * `agentId` override and `runtimeContent` are DISCARDED at drain time
   * (the combined turn resolves the thread's agent fresh and joins clean
   * content). Surfaces that need either must not opt into queueing.
   */
  queueIfBusy?: boolean
  /**
   * Pre-assembled runtime content for THIS turn (embedded surfaces inject
   * doc/context prompts here). The persisted user row always keeps the
   * clean `content`; when omitted, the runtime gets content + framing.
   */
  runtimeContent?: string
}

export interface ConversationTurnService {
  start(ctx: TurnContext, key: string, content: string, opts?: StartTurnOptions): Promise<StartTurnResult>
  /** Abort the in-flight turn; false when the thread is idle. Queued messages stay — they drain at settle. */
  abort(key: string): boolean
  /** Snapshot of the pending queue (empty for strict surfaces). */
  listQueued(key: string): QueuedMessage[]
  /** Remove one queued message by id; persists. False when absent. */
  removeQueued(key: string, id: string): boolean
  /** Drop the whole queue (delete-thread path); persists empty. */
  clearQueue(key: string): void
  /**
   * Seed the queue from persisted state (boot path) and drain immediately
   * when the slot is idle. Does NOT re-persist — the items came from disk.
   */
  restore(ctx: TurnContext, key: string, items: QueuedMessage[]): void
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
  // Pending queue per thread key (#729) — only ever populated when
  // config.queue is set and a send opted into queueIfBusy (or restore()).
  const queues = new Map<string, QueuedMessage[]>()

  const persistQueue = async (key: string) => {
    try {
      await config.queue?.persist?.(key, [...(queues.get(key) ?? [])])
    } catch (err) {
      log.error(`[${config.name}] queue persist failed for ${key}`, err as Error)
    }
  }

  /** Chain the turn's settle tail: slot release → drain → onSettled. */
  const launchTurn = (
    ctx: TurnContext,
    key: string,
    entry: InflightTurn,
    run: () => Promise<TurnOutcome | null>,
  ) => {
    entry.promise = run()
      .finally(() => {
        inflight.delete(key)
        // Drain reserves the next slot SYNCHRONOUSLY inside the release
        // block, so a racing start() can never slip between settle and
        // drain — it sees the drained turn's slot and queues behind it.
        maybeDrain(ctx, key)
      })
      .then(async (outcome) => {
        // Null = a drain that found its thread gone: nothing ran, nothing
        // to settle. Same never-throw contract as every other hook: a
        // consumer's throwing onSettled must not become an unhandled
        // rejection (or rethrow out of waitFor).
        if (!outcome) return
        try {
          await config.hooks?.onSettled?.({ ctx, key, outcome })
        } catch (err) {
          log.error(`[${config.name}] onSettled hook failed for ${key}`, err as Error)
        }
      })
  }

  /** Slot idle + queue non-empty → reserve and run the combined drained turn. */
  const maybeDrain = (ctx: TurnContext, key: string) => {
    const items = queues.get(key)
    if (!items?.length || inflight.has(key)) return
    queues.delete(key)
    const controller = new AbortController()
    const turnId = randomUUID()
    const entry: InflightTurn = {
      promise: Promise.resolve(),
      controller,
      // Enqueue-time agent — refreshed from resolveThread before the
      // runtime call. Until that refresh, listInFlight()-based attribution
      // (chat's resolveActiveTurnForAgent) can see a stale label for a
      // ms-scale window; ambiguity-is-null consumers tolerate it.
      agentId: items[items.length - 1].agentId,
      startedAt: Date.now(),
      turnId,
      livePreview: '',
    }
    inflight.set(key, entry)
    launchTurn(ctx, key, entry, () => drainRun(ctx, key, entry, items, controller, turnId))
  }

  /**
   * The drained turn: every queued message becomes its own durable user
   * row, then ONE runtime turn runs with the joined content + merged
   * attachments (spec D1).
   */
  const drainRun = async (
    ctx: TurnContext,
    key: string,
    entry: InflightTurn,
    items: QueuedMessage[],
    controller: AbortController,
    turnId: string,
  ): Promise<TurnOutcome | null> => {
    let agentId = ''
    try {
      const thread = await config.resolveThread(key)
      agentId = (thread?.agentId ?? '').trim()
    } catch (err) {
      log.error(`[${config.name}] drain resolveThread failed for ${key}`, err as Error)
    }
    if (!agentId) {
      // Thread deleted while messages waited: drop the queue durably and
      // run nothing (delete flows also clearQueue — this is the backstop).
      await persistQueue(key)
      return null
    }
    entry.agentId = agentId
    for (const m of items) {
      try {
        await config.appendRow(key, {
          kind: 'user',
          ts: m.ts,
          content: m.content,
          ...(m.attachments?.length ? { attachments: m.attachments } : {}),
        })
      } catch (err) {
        log.error(`[${config.name}] queued user row append failed for ${key}`, err as Error)
      }
    }
    // Durability handoff AFTER the rows land: a crash between append and
    // persist re-drains at boot (at-least-once — a visible duplicate over
    // a silently lost instruction).
    await persistQueue(key)
    if (config.events.started) {
      try {
        ctx.events.emit(config.events.started, { ...config.payload(key), agentId })
      } catch (emitErr) {
        // A throwing consumer payload() here would reject the retained
        // promise AFTER slot release — an unhandled rejection (and a
        // throwing waitFor). Same guard as runTurn's error-event emit.
        log.error(`[${config.name}] started-event emit failed for ${key}`, emitErr as Error)
      }
    }
    const combined = items.map((m) => m.content).join('\n\n')
    const attachments = items.flatMap((m) => m.attachments ?? [])
    return runTurn(
      config, ctx, key, agentId, combined, controller, turnId, inflight,
      attachments.length ? attachments : undefined,
    )
  }

  const start = async (
    ctx: TurnContext,
    key: string,
    content: string,
    opts?: StartTurnOptions,
  ): Promise<StartTurnResult> => {
    const thread = await config.resolveThread(key)
    if (!thread) return 'not_found'

    const attachments = opts?.attachments
    const agentId = (opts?.agentId ?? thread.agentId).trim()
    // A thread that resolves without an agent AND no per-turn override has
    // nowhere to run — fail before reserving the slot or persisting rows.
    if (!agentId) return 'not_found'

    // Attachment-only sends carry a visible placeholder — the transcript
    // (and the queued-bubble UI) shows exactly what the runtime was asked.
    if (!content.trim() && attachments?.length) {
      content = attachments.every(isRasterAttachment) ? 'See the attached image.' : 'See the attached file.'
    }

    if (inflight.has(key)) {
      if (!(opts?.queueIfBusy && config.queue)) return 'busy'
      // Busy-check → push happens in ONE synchronous block (no TOCTOU with
      // the drain's synchronous reservation). queueLength is captured HERE
      // too: after the persist await, the live array may already hold later
      // enqueues — the return and the event must describe THIS push.
      const item: QueuedMessage = {
        id: randomUUID(),
        ts: new Date().toISOString(),
        content,
        agentId,
        ...(attachments?.length ? { attachments } : {}),
      }
      const items = queues.get(key) ?? []
      items.push(item)
      queues.set(key, items)
      const queueLength = items.length
      await persistQueue(key)
      if (config.queue.event) {
        ctx.events.emit(config.queue.event, {
          ...config.payload(key),
          queueId: item.id,
          queueLength,
        })
      }
      return { queued: true, queueId: item.id, queueLength }
    }

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
    launchTurn(ctx, key, entry, () =>
      runTurn(config, ctx, key, agentId, content, controller, turnId, inflight, attachments, opts?.runtimeContent),
    )
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
    listQueued: (key) => (queues.get(key) ?? []).map((i) => ({ ...i })),
    removeQueued: (key, id) => {
      const items = queues.get(key)
      const idx = items?.findIndex((i) => i.id === id) ?? -1
      if (!items || idx < 0) return false
      items.splice(idx, 1)
      if (!items.length) queues.delete(key)
      // Fire-and-forget persist (unlike enqueue's await): a crash in the
      // write window resurrects the removed item at boot — consistent with
      // the queue's at-least-once bias (duplicate/return over loss).
      void persistQueue(key)
      return true
    },
    clearQueue: (key) => {
      queues.delete(key)
      void persistQueue(key)
    },
    restore: (ctx, key, items) => {
      if (!items.length) return
      // Restored items are the OLDER messages (they predate the restart) —
      // they go FIRST so a send that beat the boot restore drains in
      // chronological order.
      queues.set(key, [...items, ...(queues.get(key) ?? [])])
      maybeDrain(ctx, key)
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
    // Kind split: raster images ride the model-attachment lane (downscaled);
    // everything else (PDF, CSV, …) becomes a file-lane path note — a
    // non-image in `attachments` would make the runtime adapter throw.
    const images = attachments?.filter(isRasterAttachment) ?? []
    const files = attachments?.filter((a) => !isRasterAttachment(a)) ?? []
    if (images.length) {
      const media = await import('@bakin/core/media/downscale')
      cleanupPrepared = media.cleanupPreparedAttachment
      for (const a of images) {
        prepared.push(await media.prepareImageAttachment(a.path, a.mimeType))
      }
    }
    let noteSuffix = ''
    if (files.length) {
      // Lazy import — tool-access must stay out of the published SDK
      // testing bundle's graph (same rule as the downscale import above).
      let renderCall: ((tool: string, args: string) => string) | undefined
      try {
        const { renderToolCall } = await import('./tool-access')
        const access: RuntimeToolAccess = ctx.runtime.describeToolAccess()
        renderCall = (tool, args) => renderToolCall(access, { agentId, tool, args })
      } catch {
        renderCall = undefined // runtime style unknown — notes fall back to bare tool names
      }
      noteSuffix = `\n\n${files.map((f) => fileLaneNote(f, agentId, renderCall)).join('\n')}`
    }
    for await (const chunk of ctx.runtime.messaging.stream({
      agentId,
      content: (runtimeContent ?? (config.framing ? `${content}\n\n${config.framing}` : content)) + noteSuffix,
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
    } else if (config.terminalMarkerRows) {
      await persist([{ kind: 'done', ts: new Date().toISOString(), turnId }])
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
    // Abort landed before the stream produced its clean done — e.g. during
    // a drained turn's async prefix (resolveThread/row appends/attachment
    // prep), where both adapters throw kind 'aborted' on an already-aborted
    // signal. The operator asked to stop: settle CLEAN like any aborted
    // turn (dispatch's "kind 'aborted' settles clean" rule) — never an
    // error row + toast for a deliberate Stop (review finding, D3 flow).
    if (controller.signal.aborted) {
      await persist(recorder.finish() as ConversationTurnRow[])
      await persist([{ kind: 'aborted', ts: new Date().toISOString(), turnId }])
      try {
        await config.hooks?.onTurnComplete?.({ key, aborted: true })
      } catch (hookErr) {
        log.error(`[${config.name}] onTurnComplete hook failed for ${key}`, hookErr as Error)
      }
      try {
        await config.hooks?.meter?.({ key, agentId, turnId, usage: doneUsage })
      } catch (meterErr) {
        log.error(`[${config.name}] metering failed for ${key}`, meterErr as Error)
      }
      try {
        ctx.events.emit(config.events.done, {
          ...config.payload(key),
          agentId,
          ...(assistantText ? { preview: firstLine(assistantText) } : {}),
          aborted: true,
        })
      } catch (emitErr) {
        log.error(`[${config.name}] done-event emit failed for ${key}`, emitErr as Error)
      }
      return { aborted: true, errored: false }
    }
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
