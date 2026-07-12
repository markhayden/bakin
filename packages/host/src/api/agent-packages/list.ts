/**
 * GET /api/agent-packages
 *
 * Returns one info entry per runtime-known agent plus any lockfile-only
 * orphans, with state classification (absent / unmanaged /
 * managed) and the underlying lockfile entry when present.
 *
 * The Teams UI uses this for state badges; the CLI uses it for
 * `bakin agents list`. Distinct from `/api/agents` (runtime status).
 */
import { listAllAgentStates } from '@/core/agent-packages/agent-state'
import { checkPackageUpdateAsync } from '@/core/agent-packages/checker'

export async function get(_req: Request, url: URL): Promise<Response> {
  void _req
  try {
    const states = await listAllAgentStates()
    if (url.searchParams.get('check') === '1') {
      const enriched = await Promise.all(states.map(async (state) => {
        if (!state.packageId) return state
        return {
          ...state,
          updateStatus: await checkPackageUpdateAsync(state.packageId),
        }
      }))
      return Response.json({ ok: true, agents: enriched })
    }
    return Response.json({ ok: true, agents: states })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
