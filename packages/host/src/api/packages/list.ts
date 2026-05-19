/**
 * GET /api/packages
 *
 * Returns standalone reusable package entries from the lockfile. Agent-kind
 * package state lives under /api/agent-packages so `bakin packages list` does
 * not duplicate the runtime agent roster.
 */
import { readLockfile } from '@bakin/core/agent-packages/lockfile'

export async function get(_req: Request, _url: URL): Promise<Response> {
  try {
    const lock = readLockfile()
    const packages = Object.entries(lock.packages)
      .filter(([, entry]) => entry.kind !== 'agent')
      .map(([id, entry]) => ({
        id,
        kind: entry.kind,
        version: entry.version,
        source: entry.source,
        ref: entry.ref,
        commitSha: entry.commitSha,
        installedAt: entry.installedAt,
        projectionCount: entry.projections?.length ?? 0,
        refCount: entry.refCount ?? 0,
        dependents: entry.dependents ?? [],
        dependencies: entry.dependencies ?? [],
      }))
    return Response.json({ ok: true, version: lock.version, packages })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
