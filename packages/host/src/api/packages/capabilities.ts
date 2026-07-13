/**
 * GET /api/packages/capabilities
 *
 * Per-capability readiness for installed capability packs (content projected
 * / bins installed / secrets configured) with remediation strings. ONE engine
 * (src/core/agent-packages/capability-readiness) feeds this, the doctor
 * check, and the runtime hub's Capabilities tab.
 */
import { listCapabilities } from '@/core/agent-packages/capability-readiness'

export async function get(_req: Request, _url: URL): Promise<Response> {
  try {
    return Response.json({ capabilities: await listCapabilities() })
  } catch (err) {
    return Response.json(
      { capabilities: [], error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
