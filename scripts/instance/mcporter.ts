/**
 * Bridge Bakin's MCP tools to the containerized agent.
 *
 * The agent runs `mcporter call bakin-<agent>.<tool>`, which needs
 * ~/.mcporter/mcporter.json in the AGENT's container pointing at Bakin's MCP
 * endpoint. mcporter is baked into the image; this module builds the per-agent
 * config and the command to write it into the container.
 *
 * URL differs by mode: native/isolated reach the host Bakin via
 * host.docker.internal; sandbox runs Bakin in the same container (localhost).
 *
 * Boundary: dev-rig module, exempt from provider-boundary rules.
 */

/** Parse `openclaw agents list --json` output into agent ids (robust to surrounding text). */
export function parseAgentIds(agentsListJson: string): string[] {
  const match = agentsListJson.match(/\[[\s\S]*\]|\{[\s\S]*\}/)
  if (!match) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return []
  }
  const list = Array.isArray(parsed)
    ? parsed
    : ((parsed as { agents?: unknown[]; list?: unknown[] }).agents
        ?? (parsed as { list?: unknown[] }).list
        ?? [])
  if (!Array.isArray(list)) return []
  return list
    .map((a) => (a && typeof a === 'object' ? (a as { id?: string }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/** Build the mcporter.json content with a `bakin-<agent>` entry per agent. */
export function mcporterConfigJson(agents: string[], bakinUrlBase: string): string {
  const mcpServers: Record<string, { url: string; description: string }> = {}
  for (const agent of agents) {
    mcpServers[`bakin-${agent}`] = {
      url: `${bakinUrlBase}/mcp?agent=${agent}`,
      description: `Bakin MCP for ${agent}`,
    }
  }
  return JSON.stringify({ mcpServers }, null, 2) + '\n'
}

/** The Bakin MCP base URL reachable from the agent container, by mode. */
export function mcporterBakinUrlBase(inContainer: boolean): string {
  return inContainer ? 'http://localhost:3737' : 'http://host.docker.internal:3737'
}

/**
 * Command that writes the mcporter config into the agent's container. The JSON
 * is base64-encoded (only [A-Za-z0-9+/=], shell-safe) and decoded in-container.
 */
export function mcporterWriteArgs(composeFile: string, service: string, configJson: string): string[] {
  const b64 = Buffer.from(configJson, 'utf-8').toString('base64')
  return [
    'docker', 'compose', '-f', composeFile, 'exec', '-T', service, 'sh', '-c',
    `mkdir -p /home/node/.mcporter && echo ${b64} | base64 -d > /home/node/.mcporter/mcporter.json`,
  ]
}
