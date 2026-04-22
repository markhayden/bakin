/**
 * GET /api/state — legacy dashboard snapshot of every markdown file
 * under the content dir.
 *
 * Migrated from src/app/api/state/route.ts for Phase B of #147.
 */
import { readAllContent } from '@/lib/content'

export async function get(_req: Request, _url: URL): Promise<Response> {
  const files = readAllContent()
  return Response.json(files)
}
