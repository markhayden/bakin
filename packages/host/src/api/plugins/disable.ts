/** POST /api/plugins/disable — mark an installed user plugin disabled (row 98 containment); see enable-toggle.ts. */
import { toggleEnabled } from './enable-toggle'

export async function post(req: Request): Promise<Response> {
  return toggleEnabled(req, false)
}
