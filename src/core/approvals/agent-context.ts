/**
 * Which agent, if any, a filesystem path belongs to (#898 D-H5 fallback).
 *
 * Runtimes that cannot put a marker on an agent's shell (OpenClaw) still
 * run it inside the agent's workspace or a per-run dir. The CLI asks the
 * server about its cwd before honoring `--as human`; a path inside either
 * is an agent context. The operator can get a false positive by working
 * from inside an agent's workspace — documented, and the safe direction.
 */
import { realpathSync } from 'fs'
import { sep } from 'path'
import { maybeGetAppServices } from '../app-services-store'
import { createLogger } from '../logger'
import { runWorkspacesRoot } from '../run-workspace'

const log = createLogger('approvals:agent-context')

/** The answer could not be established — never read as "no agent" (#898). */
export class AgentContextUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentContextUnavailableError'
  }
}

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}

/**
 * The agent whose run dir or workspace contains `cwd`, or null when it is
 * none of theirs. Throws AgentContextUnavailableError when that cannot be
 * established (services not up, roster or a workspace lookup failing) — a
 * failed lookup is never a negative.
 */
export async function agentContextForPath(cwd: string): Promise<string | null> {
  const path = canonical(cwd)
  const runRoot = canonical(runWorkspacesRoot())
  if (within(path, runRoot) && path !== runRoot) {
    const agentId = path.slice(runRoot.length + 1).split(sep)[0]
    if (agentId) return agentId
  }
  const services = maybeGetAppServices()
  if (!services) throw new AgentContextUnavailableError('the runtime is not ready to say which agent workspaces exist')
  const { runtime } = services
  // A runtime without file-backed workspaces genuinely has none to be in.
  if (!runtime.agents.workspaces) return null
  try {
    for (const workspace of await runtime.agents.workspaces()) {
      if (within(path, canonical(workspace.path))) return workspace.agentId
    }
  } catch (err) {
    log.warn('Agent workspace lookup failed', { err: err instanceof Error ? err.message : String(err) })
    throw new AgentContextUnavailableError(`agent workspaces could not be listed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return null
}
