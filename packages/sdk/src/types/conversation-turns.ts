/**
 * Conversation turn service — the plugin-author contract for the shared
 * background turn engine (#703). The implementation lives host-side
 * (src/core/conversation-turns.ts) and reaches plugins as
 * `ctx.conversations`; these types mirror it with SDK-flavored runtime
 * types (same parallel-flavor pattern as `AgentRuntimeAdapter`).
 *
 * One engine for every conversational surface: turns run server-side,
 * detached from HTTP requests — send routes return 202 (busy → 409),
 * chunks stream as YOUR named plugin-events over the shared SSE bus, and
 * rows persist incrementally so navigation or a crash keeps the partial
 * turn. Pair with `useConversationThread` on the client.
 */
import type { RuntimeChatChunk, RuntimeMessageUsage, AgentRuntimeAdapter } from './runtime'
import type { EventBus } from './events'

export interface ConversationTurnAttachment {
  name: string
  mimeType: string
  path: string
}

/** The durable transcript row shape (identical to chat's schema-v2 rows). */
export type ConversationTurnRow =
  | { kind: 'user'; ts: string; content: string; attachments?: ConversationTurnAttachment[] }
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

export interface ConversationTurnOutcome {
  aborted: boolean
  errored: boolean
}

export type ConversationStartTurnResult = 'accepted' | 'not_found' | 'busy' | ConversationQueuedStart

/** The queued acceptance — id/length captured at push time (never a tail
 *  re-read a concurrent enqueue could poison). */
export interface ConversationQueuedStart {
  queued: true
  queueId: string
  queueLength: number
}

/**
 * A message accepted while the slot was busy (#729) — only surfaces that
 * configure `queue` and send with `queueIfBusy` ever see these. Queued
 * messages drain as ONE combined turn when the active turn settles (done,
 * error, and abort all drain), each persisting as its own user row.
 */
export interface ConversationQueuedMessage {
  id: string
  ts: string
  content: string
  /** Agent resolved at enqueue time (refreshed from resolveThread at drain). */
  agentId: string
  attachments?: ConversationTurnAttachment[]
}

export interface ConversationInflightTurnInfo {
  key: string
  agentId: string
  turnId: string
  startedAt: number
}

/** The slice of a plugin context a turn needs (messaging + the event bus). */
export interface ConversationTurnContext {
  runtime: AgentRuntimeAdapter
  events: EventBus
}

export interface ConversationStartTurnOptions {
  attachments?: ConversationTurnAttachment[]
  /** Per-turn agent override (surfaces with an agent picker); default = resolveThread's. */
  agentId?: string
  /**
   * Busy slot → enqueue instead of `'busy'` (requires the service's
   * `queue` config). CAVEAT: a queued send keeps only content +
   * attachments — `agentId` overrides and `runtimeContent` are DISCARDED
   * at drain time (the combined turn resolves the thread's agent fresh
   * and joins clean content). Surfaces needing either must not queue.
   */
  queueIfBusy?: boolean
  /**
   * Pre-assembled runtime content for THIS turn (embedded surfaces inject
   * doc/context prompts here). The persisted user row always keeps the
   * clean `content`; when omitted, the runtime gets content + framing.
   */
  runtimeContent?: string
}

export interface ConversationTurnServiceConfig {
  /** Consumer label for log lines (e.g. 'projects.brainstorm'). */
  name: string
  /** Bus event names — the consumer's wire contract. */
  events: { chunk: string; done: string; error: string; started?: string }
  /** Base payload identifying the thread on every event (e.g. key => ({ projectId: key })). */
  payload: (key: string) => Record<string, unknown>
  /** Resolve the thread's agent; null → start() returns 'not_found'. */
  resolveThread: (key: string) => { agentId: string } | null | Promise<{ agentId: string } | null>
  /** Append one durable transcript row. Failures are logged, never thrown into the turn. */
  appendRow: (key: string, row: ConversationTurnRow) => void | Promise<void>
  /** Runtime session thread id; called once per turn (per-turn schemes are legitimate). */
  threadId: (key: string, agentId: string) => string
  /** Per-turn delivery framing appended to the runtime content; never persisted. */
  framing?: string
  /** Run turns as ephemeral runtime sessions (no provider-side accumulation). */
  ephemeral?: boolean
  /**
   * Persist an invisible `{kind:'done'}` marker row at clean success settle
   * so every settled turn ends on a terminal row (`done | aborted | error`)
   * — boot-sweep evidence for stamping partial-output deaths. Chat-style
   * sweepable transcripts only: bounded stores would evict real rows and
   * foreign schemas would reject the kind. The kit's fold skips these rows.
   */
  terminalMarkerRows?: boolean
  /**
   * Opt-in pending queue (#729). Without this, a busy slot always answers
   * `'busy'` — strict surfaces are unchanged.
   */
  queue?: {
    /** Full-snapshot persistence after every queue mutation (restart durability). */
    persist?: (key: string, items: ConversationQueuedMessage[]) => void | Promise<void>
    /** Bus event emitted on enqueue (payload + queueId + queueLength).
     *  User-source plugins: must live in your `<pluginId>.*` namespace —
     *  enforced at createTurnService time like the chunk/done/error names. */
    event?: string
  }
  /**
   * Declarative spend attribution — the host meters every turn (success and
   * abort, never error) through its ONE metering engine. External plugins
   * use this; the `hooks.meter` escape hatch exists for host-side consumers
   * with bespoke needs. Ignored by the standalone test harness (no host).
   */
  metering?: {
    /**
     * Work class the spend reports under. MUST be 'chat' (the metered-only
     * interactive class) — the host rejects anything else at
     * createTurnService time; the spend dimension is enum-pinned.
     */
    workClass: 'chat'
    /**
     * Durable run id, e.g. key => `brainstorm:<pluginId>:${key}:turn:${turnId}`.
     * The host enforces the `brainstorm:<pluginId>:` prefix (prepending it
     * when absent) so plugin run ids can never collide with task:/chat: ids.
     */
    runId: (key: string, turnId: string) => string
  }
  hooks?: {
    /** Read-only tap on EVERY runtime chunk (e.g. proposal parsing). */
    onChunk?: (key: string, chunk: RuntimeChatChunk) => void
    /** Spend attribution, once per turn — success and abort, never error. */
    meter?: (info: {
      key: string
      agentId: string
      turnId: string
      usage?: RuntimeMessageUsage
    }) => Promise<void> | void
    /**
     * Success/abort path only, AFTER final row persistence but BEFORE the
     * done event — finalize derived state so it is durable when clients
     * react to done. Errors are logged, never thrown into the turn.
     */
    onTurnComplete?: (info: { key: string; aborted: boolean }) => Promise<void> | void
    /** Runs after the slot releases; waitFor() resolves after it completes. */
    onSettled?: (info: {
      ctx: ConversationTurnContext
      key: string
      outcome: ConversationTurnOutcome
    }) => Promise<unknown> | unknown
  }
}

export interface ConversationTurnService {
  start(
    ctx: ConversationTurnContext,
    key: string,
    content: string,
    opts?: ConversationStartTurnOptions,
  ): Promise<ConversationStartTurnResult>
  /** Abort the in-flight turn; false when the thread is idle. Queued messages stay — they drain at settle. */
  abort(key: string): boolean
  /** Snapshot of the pending queue (empty for strict surfaces). */
  listQueued(key: string): ConversationQueuedMessage[]
  /** Remove one queued message by id; persists. False when absent. */
  removeQueued(key: string, id: string): boolean
  /** Drop the whole queue (delete-thread path); persists empty. */
  clearQueue(key: string): void
  /** Seed the queue from persisted state (boot path); drains when idle. Does not re-persist. */
  restore(ctx: ConversationTurnContext, key: string, items: ConversationQueuedMessage[]): void
  isInFlight(key: string): boolean
  /** Await the current turn (and its onSettled); resolves immediately when idle. */
  waitFor(key: string): Promise<void>
  /** Every in-flight turn — consumers build active-turn resolution on top. */
  listInFlight(): ConversationInflightTurnInfo[]
}

/** `ctx.conversations` — build turn services for this plugin's surfaces. */
export interface ConversationTurnsAPI {
  createTurnService(config: ConversationTurnServiceConfig): ConversationTurnService
}
