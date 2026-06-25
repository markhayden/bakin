/**
 * Agent-package state detection.
 *
 * Bakin recognizes three states for a candidate agent id:
 *
 *   - 'absent'      — no runtime agent AND no lockfile entry
 *   - 'unmanaged'   — exists in the runtime roster, no lockfile entry. The
 *                     historical default for agents the user hand-built
 *                     before agent-packages shipped. Still receives the
 *                     Bakin-owned global/team AGENTS.md block — "unmanaged"
 *                     means no *package*, not no Bakin context.
 *   - 'managed'     — exists in runtime AND has a lockfile entry. Bakin owns
 *                     the package, its projected files, and the composed
 *                     workspace-file blocks. (`adopted` was collapsed into
 *                     this state by the layered-context spec; `--adopt` is
 *                     now only the install-time "bind to existing runtime
 *                     agent" action.)
 *
 * Pure read path — never mutates anything. The runtime adapter and lockfile
 * modules are mocked in tests; this module is just the cross-reference logic.
 *
 * Critical correctness: if an agent exists in the runtime roster but has no
 * lockfile entry, we MUST return 'unmanaged' (not 'absent'). Returning
 * 'absent' would let `bakin agents install` create a fresh runtime agent with
 * the same id, blowing away the user's existing setup.
 */
import {
  type Lockfile,
  type PackageEntry,
  findAgentPackage,
  readLockfile,
} from '../../../packages/core/src/agent-packages/lockfile'
import { getAppServices } from '../app-services'

export type AgentState = 'absent' | 'unmanaged' | 'managed'

export interface AgentStateInfo {
  agentId: string
  state: AgentState
  /** Installed package version from the lockfile entry, when managed. */
  version?: string
  /** Lockfile package id (typically === agentId for kind:'agent' entries). */
  packageId?: string
  /** Lockfile entry — only populated when state is 'managed'. */
  entry?: PackageEntry
}

/**
 * Determine the state of one runtime agent id.
 *
 * @param agentId      Runtime agent id to query
 * @param lockfile     Optional lockfile snapshot. When omitted, reads from
 *                     `~/.bakin/packages/lock.json` via the standard helper.
 *                     Tests pass an in-memory lockfile to avoid disk IO.
 */
async function runtimeAgentIds(): Promise<Set<string>> {
  return new Set((await getAppServices().runtime.agents.list()).map((agent) => agent.id))
}

export async function getAgentState(
  agentId: string,
  lockfile?: Lockfile,
  runtimeIds?: Set<string>,
): Promise<AgentStateInfo> {
  const ids = runtimeIds ?? (await runtimeAgentIds())
  const inRuntime = ids.has(agentId)
  const lock = lockfile ?? readLockfile()
  const owner = findAgentPackage(lock, agentId)

  if (!inRuntime && !owner) {
    return { agentId, state: 'absent' }
  }
  if (!inRuntime && owner) {
    // Lockfile says we own this agent but the runtime doesn't have it. This is
    // drift the doctor sweep should flag — for the state lookup we treat the
    // package side as authoritative because the entry is real, just orphaned.
    return {
      agentId,
      state: owner.entry.state ?? 'managed',
      version: owner.entry.version,
      packageId: owner.id,
      entry: owner.entry,
    }
  }
  if (inRuntime && !owner) {
    return { agentId, state: 'unmanaged' }
  }
  // Both — owner is non-null after this point
  const entry = owner!.entry
  return {
    agentId,
    state: entry.state ?? 'managed',
    version: entry.version,
    packageId: owner!.id,
    entry,
  }
}

/**
 * Snapshot every runtime agent plus every agent-kind entry in the lockfile
 * (in case the lockfile has an orphan record the runtime lost).
 * Single-pass — both sources read once, results cross-referenced in memory.
 */
export async function listAllAgentStates(lockfile?: Lockfile): Promise<AgentStateInfo[]> {
  const lock = lockfile ?? readLockfile()
  const agents = await getAppServices().runtime.agents.list()
  const ids = new Set(agents.map((agent) => agent.id))
  const seen = new Set<string>()
  const results: AgentStateInfo[] = []

  for (const agent of agents) {
    const info = await getAgentState(agent.id, lock, ids)
    seen.add(agent.id)
    results.push(info)
  }

  // Pick up lockfile-only orphans that the runtime doesn't know about.
  for (const [packageId, entry] of Object.entries(lock.packages)) {
    if (entry.kind !== 'agent') continue
    const agentId = entry.agentId ?? packageId
    if (seen.has(agentId)) continue
    results.push({
      agentId,
      state: entry.state ?? 'managed',
      version: entry.version,
      packageId,
      entry,
    })
  }

  return results
}
