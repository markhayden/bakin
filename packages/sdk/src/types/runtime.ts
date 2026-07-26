// Part of the @makinbakin/sdk/types contract — see ./index.ts for the
// module's self-containment + two-tier rationale.
import type { AvailableModel } from './services'

/** An agent registered with the runtime (OpenClaw, etc.). */
export interface RuntimeAgent {
  id: string
  name: string
  role?: string
  model?: string
  status?: 'active' | 'inactive' | 'unknown'
  metadata?: Record<string, unknown>
}

/** A messaging channel (Discord, Slack, email, etc.) registered with the runtime. */
export interface RuntimeChannel {
  id: string
  platform: string
  label: string
  capabilities: string[]
  metadata?: Record<string, unknown>
}

/** Whether to expose runtime-native tools for this agent turn. */
export type RuntimeMessageToolsMode = 'auto' | 'none'

/** Per-turn policy for which tools the agent may call. */
export interface RuntimeMessageToolPolicy {
  /**
   * Controls whether runtime-native tools are available for this agent turn.
   * `none` disables tools. Omit or use `auto` for runtime/provider defaults.
   */
  toolsMode?: RuntimeMessageToolsMode
  /**
   * Per-turn allowlist of BAKIN EXEC TOOLS by exact name (never
   * runtime-native tools — those are governed only by `toolsMode`).
   * Runtimes whose exec tools ride session-static transports cannot filter
   * per-turn and ignore these fields with a warning.
   */
  toolsAllow?: string[]
  /** Per-turn denylist of Bakin exec tools by exact name (same scope as `toolsAllow`). */
  toolsDeny?: string[]
}

/** Arguments for a single message dispatched to an agent. */
export interface RuntimeMessageArgs extends RuntimeMessageToolPolicy {
  agentId: string
  content: string
  /**
   * Adapter-neutral durable conversation key. Runtime adapters should map the
   * same agentId + threadId pair to the same provider/runtime session.
   */
  threadId?: string
  /** Per-turn model override (`provider/model` id); omit for the agent default. */
  model?: string
  /** Per-turn thinking level; omit for the runtime/agent default. */
  thinking?: string
  metadata?: Record<string, unknown>
}

/** Per-turn token usage, when the runtime reports it. */
export interface RuntimeMessageUsage {
  input?: number
  output?: number
  total?: number
  /** Cached-input tokens read (priced far below fresh input when known). */
  cacheRead?: number
  /** Cached-input tokens written (cache creation). */
  cacheWrite?: number
  /** Resolved model the runtime ran, when known. */
  model?: string
}

/** Result returned by a non-streaming runtime message. */
export interface RuntimeMessageResult {
  id: string
  content?: string
  /** Per-turn token usage, omitted when the runtime reported none. */
  usage?: RuntimeMessageUsage
  metadata?: Record<string, unknown>
}

/** Tool call/result event surfaced during a streaming agent turn. */
export interface RuntimeToolActivity {
  phase: 'call' | 'result'
  callId?: string
  toolName: string
  status?: 'running' | 'completed' | 'failed' | string
  summary?: string
  inputPreview?: string
  outputPreview?: string
  durationMs?: number
  exitCode?: number
  metadata?: Record<string, unknown>
}

/** Render format for a text chunk's content. Absent means 'markdown'. */
export type RuntimeChatTextFormat = 'markdown' | 'plain' | 'code'

/**
 * One chunk in a streaming agent response — the normalized turn-output
 * contract. Granularity varies by runtime (per-token to whole-turn);
 * `done` arrives exactly once and last on success AND on deliberate abort
 * (abort is a clean end, never an `error` chunk); terminal failure ends
 * the stream with an `error` chunk (`data.kind` = typed error kind when
 * known) and no `done`; tool/status chunks are best-effort liveness.
 */
export type RuntimeChatChunk =
  /** Assistant text. `format` hints rendering; absent = markdown. */
  | { type: 'text'; content: string; format?: RuntimeChatTextFormat; data?: Record<string, unknown> }
  /** Tool activity; `data` is always the structured RuntimeToolActivity. */
  | { type: 'tool'; content?: string; data: RuntimeToolActivity }
  /** Turn lifecycle hint (e.g. 'thinking'). */
  | { type: 'status'; content?: string; data?: Record<string, unknown> }
  /** Clean turn end (success or deliberate abort) — exactly once, always last.
   *  `usage` carries the turn's token accounting when the runtime reports it. */
  | { type: 'done'; content?: string; data?: Record<string, unknown>; usage?: RuntimeMessageUsage }
  /** Terminal failure — `data.kind` carries the typed error kind when known. */
  | { type: 'error'; content?: string; data?: Record<string, unknown> }

/** A cron-scheduled job tracked by the runtime. */
export interface CronJob {
  id: string
  name: string
  schedule: string
  command: string
  enabled: boolean
  toolsAllow?: string[]
  metadata?: Record<string, unknown>
}

/** Execution record for a single cron job run. */
export interface CronRun {
  id: string
  jobId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  startedAt?: string
  endedAt?: string
  output?: string
  error?: string
}

/** A skill (runtime-side capability) registered with an agent. */
export interface RuntimeSkill {
  name: string
  description?: string
}

/** A file in an agent's runtime workspace. */
export interface WorkspaceFile {
  path: string
  content?: string
}

/** Provider-agnostic interface for agent runtime adapters (OpenClaw, etc.). */
export interface AgentRuntimeAdapter {
  agents: {
    list(): Promise<RuntimeAgent[]>
    get(agentId: string): Promise<RuntimeAgent | null>
  }
  messaging: {
    send(input: RuntimeMessageArgs): Promise<RuntimeMessageResult>
    stream(input: RuntimeMessageArgs): AsyncIterable<RuntimeChatChunk>
  }
  /**
   * OPTIONAL: absent when the active runtime has no channel surface (e.g.
   * in-process runtimes). Feature-detect (`if (runtime.channels)`) — never
   * bare-deref; absence is the honest signal, not an error.
   */
  channels?: {
    list(): Promise<RuntimeChannel[]>
    sendMessage(input: {
      channels: string[]
      message: { body: string; title?: string; threadId?: string; metadata?: Record<string, unknown> }
    }): Promise<{ deliveries: Array<{ channelId: string; ref: string; renderedAt: string }> }>
    deliverContent(input: {
      channels: string[]
      content: {
        title: string
        body?: string
        url?: string
        files?: Array<{ name: string; path: string; contentType?: string }>
        metadata?: Record<string, unknown>
      }
    }): Promise<{ deliveries: Array<{ channelId: string; ref: string; renderedAt: string }> }>
  }
  /**
   * OPTIONAL: absent when the active runtime has no native cron surface.
   * Feature-detect like `channels` — Bakin-owned scheduling is unaffected.
   */
  cron?: {
    list(): Promise<CronJob[]>
    get(id: string): Promise<CronJob | null>
    create(input: { id?: string; name: string; schedule: string; command: string; enabled?: boolean; toolsAllow?: string[]; metadata?: Record<string, unknown> }): Promise<CronJob>
    update(id: string, patch: Partial<Omit<CronJob, 'id' | 'toolsAllow'>> & { toolsAllow?: string[] | null }): Promise<CronJob>
    remove(id: string): Promise<void>
    runNow(id: string): Promise<CronRun>
    listRuns(jobId: string): Promise<CronRun[]>
    getRaw(id: string, reason: string): Promise<unknown | null>
    restoreRaw(id: string, snapshot: unknown, reason: string): Promise<CronJob>
  }
  skills?: {
    list(): Promise<RuntimeSkill[]>
  }
  models?: {
    listAvailable(opts?: { includeUnavailable?: boolean }): Promise<AvailableModel[]>
  }
  /**
   * Runtime session reads (declares the surface the host facade already
   * forwards — previously reachable but undeclared). `contextStats?` is
   * itself optional within the member (the cron pattern): feature-detect,
   * never bare-deref; null = no session / nothing honest to report.
   */
  sessions?: {
    list(agentId?: string): Promise<RuntimeSessionInfo[]>
    get(sessionId: string): Promise<RuntimeSessionInfo | null>
    contextStats?(opts: { agentId: string; threadId: string }): Promise<RuntimeSessionContextStats | null>
  }
}

export interface RuntimeSessionInfo {
  id: string
  agentId: string
  title?: string
  startedAt?: string
  updatedAt?: string
  metadata?: Record<string, unknown>
}

/**
 * A session's context reading (#737) — runtime truth only. Null-honesty
 * is the contract: `tokens: null` = honestly unknown (e.g. a
 * post-compaction gap before the next reply); `compactionThreshold:
 * null` when the runtime owns compaction opaquely. Context is NEVER
 * derived from billing aggregates.
 */
export interface RuntimeSessionContextStats {
  tokens: number | null
  contextWindow: number | null
  compactionThreshold: number | null
  lastCompaction?: { at?: string; tokensBefore?: number; reason?: string }
  model?: string
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
