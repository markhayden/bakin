/**
 * GET /api/agent-packages
 *
 * Returns one info entry per runtime-known agent plus any lockfile-only
 * orphans, with state classification (absent / unmanaged / adopted /
 * managed) and the underlying lockfile entry when present.
 *
 * The Teams UI uses this for state badges; the CLI uses it for
 * `bakin agents list`. Distinct from `/api/agents` (runtime status).
 */
import { listAllAgentStates } from '@/core/agent-packages/agent-state'

export async function get(_req: Request, _url: URL): Promise<Response> {
  void _req
  void _url
  try {
    const states = await listAllAgentStates()
    return Response.json({ ok: true, agents: states })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
