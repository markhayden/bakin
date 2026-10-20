/**
 * GET /api/agent-packages
 *
 * Returns one info entry per runtime-known agent plus any lockfile-only
 * orphans, with state classification (absent / unmanaged /
 * managed) and the underlying lockfile entry when present. A managed row
 * also carries the updates engine's record for its package (`update`), so
 * the Team card and `bakin agents list` read the same observation Health
 * shows — the route itself never probes a source (#1007).
 *
 * The Teams UI uses this for state badges; the CLI uses it for
 * `bakin agents list`. Distinct from `/api/agents` (runtime status).
 */
import type { UpdateRecord } from '@makinbakin/sdk/types'
import { listAllAgentStates, type AgentStateInfo } from '@/core/agent-packages/agent-state'
import { getUpdatesEngine } from '@/core/updates/service'
import { packageIdOfKey } from '@/core/updates/sources/package'

export interface AgentPackageRow extends AgentStateInfo {
  /** The updates engine's record for the installed package, when it has one. */
  update?: UpdateRecord
}

/** The engine's package records by lockfile key id (`package:<id>`); empty without a running engine. */
async function packageRecords(): Promise<ReadonlyMap<string, UpdateRecord>> {
  const engine = getUpdatesEngine()
  if (!engine) return new Map()
  const snapshot = await engine.snapshot()
  return new Map(snapshot.records.filter((record) => record.subject.kind === 'package').map((record) => [record.id, record]))
}

export function joinPackageUpdates(states: readonly AgentStateInfo[], records: ReadonlyMap<string, UpdateRecord>): AgentPackageRow[] {
  return states.map((state) => {
    const record = state.packageId ? records.get(`package:${packageIdOfKey(state.packageId)}`) : undefined
    return record ? { ...state, update: record } : state
  })
}

export async function get(_req: Request): Promise<Response> {
  void _req
  try {
    const [states, records] = await Promise.all([listAllAgentStates(), packageRecords()])
    return Response.json({ ok: true, agents: joinPackageUpdates(states, records) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
