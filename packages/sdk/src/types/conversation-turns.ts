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
import type { EventBus } from './context'

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

export interface ConversationTurnOutcome {
  aborted: boolean
  errored: boolean
}

export type ConversationStartTurnResult = 'accepted' | 'not_found' | 'busy'

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
  events: { chunk: string; done: string; error: string }
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
   * Declarative spend attribution — the host meters every turn (success and
   * abort, never error) through its ONE metering engine. External plugins
   * use this; the `hooks.meter` escape hatch exists for host-side consumers
   * with bespoke needs. Ignored by the standalone test harness (no host).
   */
  metering?: {
    /** Work class the spend reports under (interactive surfaces: 'chat'). */
    workClass: string
    /** Durable run id, e.g. key => `brainstorm:projects:${key}:turn:${turnId}`. */
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
  /** Abort the in-flight turn; false when the thread is idle. */
  abort(key: string): boolean
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
