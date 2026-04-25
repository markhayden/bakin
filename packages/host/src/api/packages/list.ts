/**
 * GET /api/packages
 *
 * Returns every entry in the lockfile — agents AND standalone packs —
 * with their kind, version, source, refCount, dependents, and projection
 * counts. The Teams UI renders this as a table; the CLI uses it for
 * `bakin packages list`.
 */
import { readLockfile } from '@bakin/core/agent-packages/lockfile'

export async function get(_req: Request, _url: URL): Promise<Response> {
  try {
    const lock = readLockfile()
    const packages = Object.entries(lock.packages).map(([id, entry]) => ({
      id,
      kind: entry.kind,
      version: entry.version,
      source: entry.source,
      ref: entry.ref,
      commitSha: entry.commitSha,
      installedAt: entry.installedAt,
      state: entry.state,
      agentId: entry.agentId,
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
