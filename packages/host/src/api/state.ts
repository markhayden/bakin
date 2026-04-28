/**
 * GET /api/state — dashboard snapshot of every markdown file under the
 * content directory.
 */
import { readAllContent } from '@/lib/content-files'

export async function get(_req: Request, _url: URL): Promise<Response> {
  const files = readAllContent()
  return Response.json(files)
}
