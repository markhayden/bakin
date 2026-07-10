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
  /** OpenClaw per-server MCP request timeout (ms). */
  requestTimeoutMs?: number
  /**
   * OpenClaw HTTP transport selection. MUST be `streamable-http`: the
   * embedded runtime's MCP client DEFAULTS to the legacy SSE transport when
   * `type` is absent, and Bakin's /mcp endpoint no longer speaks legacy SSE
   * (sessionless GETs are 405 — the legacy handshake made the codex client
   * stall a fixed 5s per turn before falling back).
   */
  type?: string
}

/** The only transport Bakin's /mcp endpoint speaks. */
export const BAKIN_MCP_TRANSPORT_TYPE = 'streamable-http'

export interface BakinMcpConfig {
  mcp?: { servers?: Record<string, BakinMcpServerEntry> }
  [key: string]: unknown
}

const BAKIN_PREFIX = 'bakin-'
const BAKIN_DESCRIPTION_PREFIX = 'Bakin MCP for '

/**
 * Per-server MCP request timeout. OpenClaw's client default (60s) kills long
 * Bakin tool calls — P5.3 live: `bakin_exec_images_generate` (gpt-image-2)
 * timed out client-side mid-render. 600s matches the old mcporter budget.
 */
export const BAKIN_MCP_REQUEST_TIMEOUT_MS = 600_000

/** MCP server name for an agent: `bakin-<agent>`. */
export function serverName(agent: string): string {
  return `${BAKIN_PREFIX}${agent}`
}

/**
 * Ownership tag: only entries WE wrote (description `Bakin MCP for <agent>`)
 * are ever pruned/removed. A user's own `bakin-docs` server — or an entry
 * whose description they edited — is theirs and survives every provision.
 */
function isBakinOwnedEntry(name: string, entry: BakinMcpServerEntry): boolean {
  return name.startsWith(BAKIN_PREFIX) && (entry.description ?? '').startsWith(BAKIN_DESCRIPTION_PREFIX)
}

/** Per-agent MCP URL against Bakin's server base (e.g. `http://localhost:3737`). */
export function mcpUrl(agent: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/mcp?agent=${encodeURIComponent(agent)}`
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
    if (
      !existing ||
      existing.url !== url ||
      existing.requestTimeoutMs !== BAKIN_MCP_REQUEST_TIMEOUT_MS ||
      existing.type !== BAKIN_MCP_TRANSPORT_TYPE
    ) {
      servers[name] = {
        url,
        description: `Bakin MCP for ${agent}`,
        requestTimeoutMs: BAKIN_MCP_REQUEST_TIMEOUT_MS,
        type: BAKIN_MCP_TRANSPORT_TYPE,
      }
      changes.push(existing ? `updated ${name}` : `added ${name}`)
    }
  }

  for (const key of Object.keys(servers)) {
    if (!isBakinOwnedEntry(key, servers[key])) continue
    const agentName = key.slice(BAKIN_PREFIX.length)
    if (!agents.includes(agentName)) {
      delete servers[key]
      changes.push(`removed ${key} (agent no longer in runtime config)`)
    }
  }

  return changes
}

/** Remove all Bakin-OWNED server entries (deprovision). Mutates in place. */
export function removeBakinMcpEntries(config: BakinMcpConfig): string[] {
  const servers = config.mcp?.servers
  if (!servers) return []
  const changes: string[] = []
  for (const key of Object.keys(servers)) {
    if (isBakinOwnedEntry(key, servers[key])) {
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
    const correct =
      entry?.url === expectedUrl &&
      entry?.requestTimeoutMs === BAKIN_MCP_REQUEST_TIMEOUT_MS &&
      entry?.type === BAKIN_MCP_TRANSPORT_TYPE
    return { agent, name, url: entry?.url ?? '', correct }
  })
  const staleEntries = Object.keys(servers).filter(
    (key) => isBakinOwnedEntry(key, servers[key]) && !agents.includes(key.slice(BAKIN_PREFIX.length)),
  )
  return { agentEntries, staleEntries }
}
