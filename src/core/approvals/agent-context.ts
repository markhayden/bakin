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

/** The agent whose run dir or workspace contains `cwd`, or null. */
export async function agentContextForPath(cwd: string): Promise<string | null> {
  const path = canonical(cwd)
  const runRoot = canonical(runWorkspacesRoot())
  if (within(path, runRoot) && path !== runRoot) {
    const agentId = path.slice(runRoot.length + 1).split(sep)[0]
    if (agentId) return agentId
  }
  const runtime = maybeGetAppServices()?.runtime
  if (!runtime?.agents.workspacePath) return null
  let agents: Array<{ id: string }>
  try {
    agents = await runtime.agents.list()
  } catch (err) {
    log.warn('Agent workspace lookup failed — no workspace context', { err: err instanceof Error ? err.message : String(err) })
    return null
  }
  for (const agent of agents) {
    const workspace = await runtime.agents.workspacePath(agent.id).catch(() => null)
    if (workspace && within(path, canonical(workspace))) return agent.id
  }
  return null
}
