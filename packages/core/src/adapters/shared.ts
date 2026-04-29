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

export interface AdapterInitOpts {
  contentDir: string
  settings?: Record<string, unknown>
  logger?: AdapterLogger
  audit?: (event: AdapterAuditEvent) => void
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
