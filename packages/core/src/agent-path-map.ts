/**
 * Agent-path translation for split-filesystem dev setups.
 *
 * BAKIN_AGENT_PATH_MAP="from=to[;from=to]" maps absolute paths reported by
 * agents (e.g. container workspace paths in the dockerized dev rig, where the
 * runtime home is bind-mounted on the host) to host-readable paths before
 * Bakin reads the file. Inert when unset or when no prefix matches — in
 * production runtime and Bakin share one filesystem, so paths pass through
 * untouched. Prefix matches respect path boundaries; first match wins.
 */

export interface AgentPathMapping {
  from: string
  to: string
}

function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p
}

export function parseAgentPathMap(raw: string | undefined): AgentPathMapping[] {
  if (!raw) return []
  const mappings: AgentPathMapping[] = []
  for (const entry of raw.split(';')) {
    const eq = entry.indexOf('=')
    if (eq <= 0) continue
    const from = stripTrailingSlash(entry.slice(0, eq).trim())
    const to = stripTrailingSlash(entry.slice(eq + 1).trim())
    if (!from || !to) continue
    mappings.push({ from, to })
  }
  return mappings
}

export function translateAgentPathWith(path: string, mappings: AgentPathMapping[]): string {
  for (const { from, to } of mappings) {
    if (path === from) return to
    if (path.startsWith(from + '/')) return to + path.slice(from.length)
  }
  return path
}

/** Translate using the live env — read per call so tests and the rig can vary it. */
export function translateAgentPath(path: string): string {
  return translateAgentPathWith(path, parseAgentPathMap(process.env.BAKIN_AGENT_PATH_MAP))
}
