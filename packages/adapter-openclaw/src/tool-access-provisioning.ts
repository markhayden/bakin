/**
 * OpenClaw tool-access provisioning (relocated from core in P1.3).
 *
 * OpenClaw agents reach Bakin's exec tools over native MCP: each agent gets a
 * `bakin-<agent>` entry in the runtime config's `mcp.servers` pointing at
 * Bakin's MCP server. These are the pure config transforms — the adapter wraps
 * them with config read/write + audit so core never touches OpenClaw's config
 * shape.
 */

export interface BakinMcpServerEntry {
  url?: string
  description?: string
}

export interface BakinMcpConfig {
  mcp?: { servers?: Record<string, BakinMcpServerEntry> }
  [key: string]: unknown
}

const BAKIN_PREFIX = 'bakin-'

/** MCP server name for an agent: `bakin-<agent>`. */
export function serverName(agent: string): string {
  return `${BAKIN_PREFIX}${agent}`
}

/** Per-agent MCP URL against Bakin's server base (e.g. `http://localhost:3737`). */
export function mcpUrl(agent: string, baseUrl: string): string {
  return `${baseUrl}/mcp?agent=${agent}`
}

/**
 * Add/refresh Bakin's per-agent entries and prune Bakin entries for agents
 * that no longer exist. Mutates `config` in place; returns human-readable
 * change descriptions (empty when already current).
 */
export function applyBakinMcpEntries(
  config: BakinMcpConfig,
  agents: string[],
  baseUrl: string,
): string[] {
  config.mcp ??= {}
  config.mcp.servers ??= {}
  const servers = config.mcp.servers
  const changes: string[] = []

  for (const agent of agents) {
    const name = serverName(agent)
    const url = mcpUrl(agent, baseUrl)
    const existing = servers[name]
    if (!existing || existing.url !== url) {
      servers[name] = { url, description: `Bakin MCP for ${agent}` }
      changes.push(existing ? `updated ${name}` : `added ${name}`)
    }
  }

  for (const key of Object.keys(servers)) {
    if (!key.startsWith(BAKIN_PREFIX)) continue
    const agentName = key.slice(BAKIN_PREFIX.length)
    if (!agents.includes(agentName)) {
      delete servers[key]
      changes.push(`removed ${key} (agent no longer in runtime config)`)
    }
  }

  return changes
}

/** Remove ALL Bakin `bakin-*` server entries (deprovision). Mutates in place. */
export function removeBakinMcpEntries(config: BakinMcpConfig): string[] {
  const servers = config.mcp?.servers
  if (!servers) return []
  const changes: string[] = []
  for (const key of Object.keys(servers)) {
    if (key.startsWith(BAKIN_PREFIX)) {
      delete servers[key]
      changes.push(`removed ${key}`)
    }
  }
  return changes
}

export interface BakinMcpVerifyStatus {
  agentEntries: Array<{ agent: string; name: string; url: string; correct: boolean }>
  staleEntries: string[]
}

/** Read-only: which agent entries are present/correct and which are stale. */
export function verifyBakinMcpEntries(
  config: BakinMcpConfig,
  agents: string[],
  baseUrl: string,
): BakinMcpVerifyStatus {
  const servers = config.mcp?.servers ?? {}
  const agentEntries = agents.map((agent) => {
    const name = serverName(agent)
    const expectedUrl = mcpUrl(agent, baseUrl)
    const entry = servers[name]
    return { agent, name, url: entry?.url ?? '', correct: entry?.url === expectedUrl }
  })
  const staleEntries = Object.keys(servers).filter(
    (key) => key.startsWith(BAKIN_PREFIX) && !agents.includes(key.slice(BAKIN_PREFIX.length)),
  )
  return { agentEntries, staleEntries }
}
