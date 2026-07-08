/**
 * Pi home directory resolution — adapter-private, mirroring
 * adapter-openclaw/src/home.ts. Resolution: PI_HOME env → ~/.pi.
 *
 * Everything Bakin knows about Pi's on-disk world hangs off this root:
 *   <home>/agent/settings.json        Pi's own settings (config surface)
 *   <home>/agent/auth.json            provider credentials (never read as content)
 *   <home>/agent/skills/              global skills
 *   <home>/agent/bakin-agents.json    Bakin's agent registry (adapter-owned)
 *   <home>/agent/agents/<id>/workspace/   per-agent cwd (AGENTS.md etc.)
 *   <home>/agent/agents/<id>/sessions/    per-agent session store
 */
import { homedir } from 'os'
import { join } from 'path'

let resolved: string | null = null

export function getPiHome(): string {
  if (resolved) return resolved
  resolved = process.env.PI_HOME || join(homedir(), '.pi')
  return resolved
}

export function getPiPath(...parts: string[]): string {
  return join(getPiHome(), ...parts)
}

/** Reset the cached home (tests only). */
export function resetPiHome(): void {
  resolved = null
}

export function getPiAgentDir(): string {
  return getPiPath('agent')
}

export function getPiRegistryPath(): string {
  return getPiPath('agent', 'bakin-agents.json')
}

export function getPiAgentsRoot(): string {
  return getPiPath('agent', 'agents')
}

export function getAgentWorkspaceDir(agentId: string): string {
  return join(getPiAgentsRoot(), agentId, 'workspace')
}

export function getAgentSessionsDir(agentId: string): string {
  return join(getPiAgentsRoot(), agentId, 'sessions')
}
