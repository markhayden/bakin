/**
 * GET /api/version — the running Bakin version. Stable contract used by the CLI.
 */
import { APP_VERSION } from '@bakin/core/constants'

export async function get(_req: Request, _url: URL): Promise<Response> {
  void _req
  void _url
  return Response.json({ version: APP_VERSION })
}
