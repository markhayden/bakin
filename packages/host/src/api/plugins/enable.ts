/** POST /api/plugins/enable — clear a plugin's disabled mark and activate it again; see enable-toggle.ts. */
import { toggleEnabled } from './enable-toggle'

export async function post(req: Request): Promise<Response> {
  return toggleEnabled(req, true)
}
