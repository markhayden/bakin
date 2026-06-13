/**
 * GET/PUT /api/agents/settings — agents plugin configuration.
 *
 * Migrated from src/app/api/agents/settings/route.ts for Phase B of #147.
 */
import { readPluginSettings, writePluginSettings } from '@bakin/core/plugins/settings-store'

export async function get(_req: Request, _url: URL): Promise<Response> {
  return Response.json(readPluginSettings('agents'))
}

export async function put(req: Request, _url: URL): Promise<Response> {
  const body = await req.json()
  writePluginSettings('agents', body)
  return Response.json({ ok: true })
}
