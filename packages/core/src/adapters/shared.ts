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
   * Base URL of Bakin's MCP server (e.g. `http://localhost:3737`) — the seam
   * a runtime whose agents reach Bakin over MCP (OpenClaw) needs to write its
   * per-agent server entries during `provisionToolAccess`. Core knows the
   * port; the adapter does not, so it is threaded here. In-process runtimes
   * (Pi) ignore it.
   */
  bakinMcpBaseUrl?: string
}

export interface AdapterHealthCheckResult {
  check: string
  status: 'ok' | 'warn' | 'error' | 'fixed'
  message: string
  autoFixable: boolean
}

export interface AdapterHealthCheckDefinition {
  id: string
  name: string
  run(): Promise<AdapterHealthCheckResult[]>
  autoFix?: boolean
}

export interface AdapterVersionInfo {
  readonly name: string
  readonly version: string
  readonly requiredCoreVersion?: string
}
