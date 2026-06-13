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

/** Per-turn policy for which runtime tools the agent may call. */
export interface RuntimeMessageToolPolicy {
  /**
   * Controls whether runtime-native tools are available for this agent turn.
   * `none` disables tools. Omit or use `auto` for runtime/provider defaults.
   */
  toolsMode?: RuntimeMessageToolsMode
  /** Optional runtime-native tool allowlist for this turn. */
  toolsAllow?: string[]
  /** Optional runtime-native tool denylist for this turn. */
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
  metadata?: Record<string, unknown>
}

/** Result returned by a non-streaming runtime message. */
export interface RuntimeMessageResult {
  id: string
  content?: string
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

/** One chunk in a streaming agent response (text, tool, status, done, error). */
export interface RuntimeChatChunk {
  type: 'text' | 'tool' | 'status' | 'done' | 'error'
  content?: string
  data?: Record<string, unknown> | RuntimeToolActivity
}

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
  channels: {
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
  cron: {
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
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
