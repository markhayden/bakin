import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { createAppServices, maybeGetAppServices } from './app-services'
import { mcpUrl, serverName } from './mcporter'

interface RuntimeMcpServerEntry {
  url?: string
  description?: string
}

interface RuntimeBakinMcpConfig {
  mcp?: {
    servers?: Record<string, RuntimeMcpServerEntry>
  }
}

export interface RuntimeMcpEntryStatus {
  agent: string
  name: string
  url: string
  correct: boolean
}

export interface RuntimeMcpConfigStatus {
  agentEntries: RuntimeMcpEntryStatus[]
  staleEntries: string[]
}

async function getRuntime(): Promise<AgentRuntimeAdapter> {
  const existing = maybeGetAppServices()?.runtime
  if (existing) return existing
  return (await createAppServices()).runtime
}

async function listRuntimeAgentIds(runtime: AgentRuntimeAdapter): Promise<string[]> {
  return (await runtime.agents.list()).map((agent) => agent.id).filter(Boolean)
}

export async function syncOpenClawMcpConfig(port: number): Promise<string[]> {
  const runtime = await getRuntime()
  const agents = await listRuntimeAgentIds(runtime)
  const config = await runtime.config.get<RuntimeBakinMcpConfig>()
  const changes: string[] = []

  config.mcp ??= {}
  config.mcp.servers ??= {}

  for (const agent of agents) {
    const name = serverName(agent)
    const url = mcpUrl(agent, port)
    const existing = config.mcp.servers[name]
    if (!existing || existing.url !== url) {
      config.mcp.servers[name] = {
        url,
        description: `Bakin MCP for ${agent}`,
      }
      changes.push(existing ? `updated ${name}` : `added ${name}`)
    }
  }

  for (const key of Object.keys(config.mcp.servers)) {
    if (!key.startsWith('bakin-')) continue
    const agentName = key.slice('bakin-'.length)
    if (!agents.includes(agentName)) {
      delete config.mcp.servers[key]
      changes.push(`removed ${key} (agent no longer in runtime config)`)
    }
  }

  if (changes.length > 0) {
    await runtime.config.replace(config, 'bakin.onboarding.openclaw-mcp')
  }

  return changes
}

export async function verifyOpenClawMcpConfig(port: number): Promise<RuntimeMcpConfigStatus> {
  const runtime = await getRuntime()
  const agents = await listRuntimeAgentIds(runtime)
  const config = await runtime.config.get<RuntimeBakinMcpConfig>()
  const servers = config.mcp?.servers ?? {}

  const agentEntries = agents.map((agent) => {
    const name = serverName(agent)
    const expectedUrl = mcpUrl(agent, port)
    const entry = servers[name]
    return {
      agent,
      name,
      url: entry?.url ?? '',
      correct: entry?.url === expectedUrl,
    }
  })

  const staleEntries = Object.keys(servers)
    .filter((key) => key.startsWith('bakin-') && !agents.includes(key.slice('bakin-'.length)))

  return {
    agentEntries,
    staleEntries,
  }
}
