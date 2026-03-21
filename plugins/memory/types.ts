export interface AuditEntry {
  ts: string
  event: string
  agent: string
  data: Record<string, unknown>
}

export interface GatewayLogEntry {
  timestamp: string
  level: string
  message: string
  raw: string
}

export interface AgentWorkspace {
  files: Record<string, string>
  memoryFiles: Record<string, string>
}
