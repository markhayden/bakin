/**
 * GET /api/plugin-settings/schemas — surface every plugin's settings
 * schema for the dynamic settings page renderer.
 *
 * Migrated from src/app/api/plugin-settings/schemas/route.ts for Phase B
 * of #147.
 */
import { pluginRegistry } from '@/core/plugin-registry'

export async function get(_req: Request, _url: URL): Promise<Response> {
  const schemas = pluginRegistry.getSettingsSchemas()
  return Response.json(schemas)
}
