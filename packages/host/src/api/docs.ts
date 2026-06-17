/**
 * GET /api/docs — legacy `{ routes }` shape. Stable contract for CLI consumers
 * (`bakin plugins list`, `bakin docs`) until the OpenAPI surface becomes canonical.
 */
import { getAllRoutes } from '@/core/api-docs'

export async function get(_req: Request, _url: URL): Promise<Response> {
  void _req
  void _url
  return Response.json({ routes: getAllRoutes() })
}
