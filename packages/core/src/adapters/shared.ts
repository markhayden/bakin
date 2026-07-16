import type { ActivityClass } from '@makinbakin/sdk/types'

export type Unsubscribe = () => void

export interface AdapterLogger {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
}

export interface AdapterAuditEvent {
  adapter: string
  action: string
  subject?: string
  data?: Record<string, unknown>
  at?: string
}

/**
 * One Bakin exec tool as offered across the adapter boundary. The zod
 * shapes stay core-side; adapters receive plain JSON Schema so no
 * validation library leaks into the contract.
 */
export interface RuntimeExecToolDescriptor {
  name: string
  description: string
  /** JSON Schema (object) for the tool's parameters. */
  parametersSchema: Record<string, unknown>
}

export interface RuntimeExecToolInvokeResult {
  ok: boolean
  /** Model-facing result text (JSON on success, `ERROR: …` on failure). */
  text: string
}

/** Token usage for one agent turn, when the runtime reports it. */
export interface MessageUsage {
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

/**
 * One normalized runtime-native tool lifecycle event observed by an adapter.
 * The host uses result events for cross-runtime observability; call events are
 * included so it can derive duration when the runtime does not report one.
 */
interface AdapterToolActivityBase {
  agentId: string
  /** Producer-assigned classification from the originating runtime turn. */
  activityClass: ActivityClass
  /** Owning adapter turn; required so terminal reconciliation cannot silently opt out. */
  turnId: string
  threadId?: string
  callId?: string
  toolName: string
}

/**
 * One normalized tool lifecycle event. Runtime-private status aliases must be
 * resolved by the adapter before crossing this boundary.
 */
export type AdapterToolActivityEvent =
  | AdapterToolActivityBase & {
      phase: 'call'
      status: 'running'
    }
  | AdapterToolActivityBase & {
      phase: 'result'
      status: 'completed' | 'failed' | 'aborted'
      durationMs?: number
    }

interface AdapterTurnActivityBase {
  agentId: string
  /** Producer-assigned classification from the originating runtime turn. */
  activityClass: ActivityClass
  threadId?: string
  /** Messaging surface that owns the turn. */
  operation: 'send' | 'stream'
  /** Adapter-generated identity shared by this turn's start and result. */
  turnId: string
}

/**
 * One normalized messaging turn lifecycle event observed at the adapter
 * boundary. Every executed send/stream emits exactly one start and one result.
 * Result identity and usage are present when the messaging surface reports
 * them (currently send); adapters never fabricate usage.
 */
export type AdapterTurnActivityEvent =
  | AdapterTurnActivityBase & {
      phase: 'start'
      status: 'running'
    }
  | AdapterTurnActivityBase & {
      phase: 'result'
      status: 'completed' | 'failed' | 'aborted'
      durationMs: number
      resultId?: string
      usage?: MessageUsage
    }

/**
 * Bakin's exec-tool registry offered to runtimes that deliver tools
 * in-process (Pi registers these as native session tools). Out-of-band
 * runtimes (OpenClaw reaches the same registry over its native MCP client)
 * ignore it. `list()` reads the LIVE registry — call it at session build
 * time so late plugin registrations and hot reloads are visible.
 * Usage recording + audit happen inside `invoke`; adapters add nothing.
 */
export interface RuntimeExecToolProvider {
  list(): RuntimeExecToolDescriptor[]
  invoke(name: string, params: Record<string, unknown>, agentId: string): Promise<RuntimeExecToolInvokeResult>
}

export interface AdapterInitOpts {
  contentDir: string
  settings?: Record<string, unknown>
  /**
   * LIVE view of the adapter-private settings bag. `settings` is a boot-time
   * snapshot; surfaces whose behavior must track settings edits WITHOUT a
   * restart (extension trust policy, per-turn knobs) read through this.
   * Optional: tests and thin callers may omit it (snapshot semantics).
   */
  getLiveSettings?: () => Record<string, unknown> | undefined
  logger?: AdapterLogger
  audit?: (event: AdapterAuditEvent) => void
  execTools?: RuntimeExecToolProvider
  /**
   * Best-effort host observability tap for tool activity across every runtime
   * messaging surface. Adapters contain callback failures so telemetry can
   * never fail an agent turn.
   */
  onToolActivity?: (event: AdapterToolActivityEvent) => void
  /**
   * Best-effort host observability tap for every messaging send/stream turn.
   * Adapters contain callback failures so telemetry can never fail a turn.
   */
  onTurnActivity?: (event: AdapterTurnActivityEvent) => void
  /**
   * Base URL of Bakin's MCP server (e.g. `http://localhost:3737`) — the seam
   * a runtime whose agents reach Bakin over MCP (OpenClaw) needs to write its
   * per-agent server entries during `provisionToolAccess`. Core knows the
   * port; the adapter does not, so it is threaded here. In-process runtimes
   * (Pi) ignore it.
   */
  bakinMcpBaseUrl?: string
}

export interface AdapterVersionInfo {
  readonly name: string
  readonly version: string
  readonly requiredCoreVersion?: string
}
