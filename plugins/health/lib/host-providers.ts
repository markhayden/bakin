export interface HealthMcpSession {
  agent: string
  sessions: number
  connectedAt: string
}

export interface HealthMcpSessionsSnapshot {
  activeSessions: HealthMcpSession[]
  upSince: string
}

type RegistryAccessor = () => Array<Record<string, unknown>>
type McpSessionsAccessor = () => HealthMcpSessionsSnapshot

type HealthHostProviderGlobals = typeof globalThis & {
  __bakinGetRegistrySnapshot?: RegistryAccessor
  __bakinGetMcpSessions?: McpSessionsAccessor
}

export type HealthHostProvider = 'plugin-registry' | 'mcp-sessions'

export class HealthHostProviderUnavailableError extends Error {
  readonly provider: HealthHostProvider

  constructor(provider: HealthHostProvider) {
    super(`Health host provider is unavailable: ${provider}`)
    this.name = 'HealthHostProviderUnavailableError'
    this.provider = provider
  }
}

function hostGlobals(): HealthHostProviderGlobals {
  return globalThis as HealthHostProviderGlobals
}

export function getRegistrySnapshot(): Array<Record<string, unknown>> {
  const accessor = hostGlobals().__bakinGetRegistrySnapshot
  if (!accessor) throw new HealthHostProviderUnavailableError('plugin-registry')
  return accessor()
}

export function getMcpSessions(): HealthMcpSessionsSnapshot {
  const accessor = hostGlobals().__bakinGetMcpSessions
  if (!accessor) throw new HealthHostProviderUnavailableError('mcp-sessions')
  return accessor()
}
