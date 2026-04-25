/**
 * Agent-package state detection.
 *
 * Bakin recognizes four states for a candidate agent id:
 *
 *   - 'absent'      — no entry in openclaw.json AND no lockfile entry
 *   - 'unmanaged'   — exists in openclaw.json, no lockfile entry. The
 *                     historical default for agents the user hand-built
 *                     before agent-packages shipped.
 *   - 'adopted'     — exists in openclaw.json AND has a lockfile entry
 *                     with state='adopted'. Bakin tracks managed-block
 *                     attachments + knowledge toggles but does not own
 *                     the workspace files.
 *   - 'managed'     — exists in openclaw.json AND has a lockfile entry
 *                     with state='managed'. Bakin owns the package +
 *                     projected files.
 *
 * Pure read path — never mutates anything. Both `openclaw-config` and
 * `lockfile` modules are mocked in tests; this module is just the
 * cross-reference logic.
 *
 * Critical correctness: if an agent exists in openclaw.json but has no
 * lockfile entry, we MUST return 'unmanaged' (not 'absent'). Returning
 * 'absent' would let `bakin agents install` create a fresh OpenClaw
 * agent with the same id, blowing away the user's existing setup.
 */
import {
  type Lockfile,
  type PackageEntry,
  findAgentPackage,
  readLockfile,
} from '../../../packages/core/src/agent-packages/lockfile'
import { findAgentById, getAgentList } from '../../../packages/core/src/openclaw-config'

export type AgentState = 'absent' | 'unmanaged' | 'adopted' | 'managed'

export interface AgentStateInfo {
  agentId: string
  state: AgentState
  /** Lockfile package id (typically === agentId for kind:'agent' entries). */
  packageId?: string
  /** Lockfile entry — only populated when state is 'managed' or 'adopted'. */
  entry?: PackageEntry
}

/**
 * Determine the state of one OpenClaw agent id.
 *
 * @param agentId      OpenClaw agent id to query
 * @param lockfile     Optional lockfile snapshot. When omitted, reads from
 *                     `~/.bakin/packages/lock.json` via the standard helper.
 *                     Tests pass an in-memory lockfile to avoid disk IO.
 */
export function getAgentState(
  agentId: string,
  lockfile?: Lockfile,
): AgentStateInfo {
  const inOpenClaw = findAgentById(agentId) !== null
  const lock = lockfile ?? readLockfile()
  const owner = findAgentPackage(lock, agentId)

  if (!inOpenClaw && !owner) {
    return { agentId, state: 'absent' }
  }
  if (!inOpenClaw && owner) {
    // Lockfile says we own this agent but OpenClaw doesn't have it. This is
    // drift the doctor sweep should flag — for the state lookup we treat the
    // package side as authoritative because the entry is real, just orphaned.
    return { agentId, state: owner.entry.state ?? 'managed', packageId: owner.id, entry: owner.entry }
  }
  if (inOpenClaw && !owner) {
    return { agentId, state: 'unmanaged' }
  }
  // Both — owner is non-null after this point
  const entry = owner!.entry
  return {
    agentId,
    state: entry.state ?? 'managed',
    packageId: owner!.id,
    entry,
  }
}

/**
 * Snapshot every agent OpenClaw knows about plus every agent-kind entry in
 * the lockfile (in case the lockfile has an orphan record OpenClaw lost).
 * Single-pass — both sources read once, results cross-referenced in memory.
 */
export function listAllAgentStates(lockfile?: Lockfile): AgentStateInfo[] {
  const lock = lockfile ?? readLockfile()
  const seen = new Set<string>()
  const results: AgentStateInfo[] = []

  for (const agent of getAgentList()) {
    const info = getAgentState(agent.id, lock)
    seen.add(agent.id)
    results.push(info)
  }

  // Pick up lockfile-only orphans that OpenClaw doesn't know about.
  for (const [packageId, entry] of Object.entries(lock.packages)) {
    if (entry.kind !== 'agent') continue
    const agentId = entry.agentId ?? packageId
    if (seen.has(agentId)) continue
    results.push({
      agentId,
      state: entry.state ?? 'managed',
      packageId,
      entry,
    })
  }

  return results
}
