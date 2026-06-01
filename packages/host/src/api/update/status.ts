/**
 * GET /api/update/status
 *
 * Browser-safe status check for Bakin binary updates. In source/dev mode this
 * returns supported:false and never probes GitHub.
 */
import { APP_VERSION } from '@bakin/core/constants'
import { getSelfUpdateStatus } from '@/core/self-update'

export async function get(_req: Request, _url: URL): Promise<Response> {
  void _req
  void _url
  const status = await getSelfUpdateStatus({ currentVersion: APP_VERSION })
  return Response.json({ ok: true, ...status })
}
