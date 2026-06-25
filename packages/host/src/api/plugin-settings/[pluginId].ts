/**
 * GET/PUT /api/plugin-settings/{pluginId} — per-plugin settings.
 *
 * Migrated from src/app/api/plugin-settings/[pluginId]/route.ts for
 * Phase B of #147. The {pluginId} segment is parsed from url.pathname.
 */
import { PLUGIN_ID_RE } from '@bakin/core/plugins/manifest'
import { readPluginSettings, writePluginSettings } from '@bakin/core/plugins/settings-store'
import { broadcastPluginSettingsChanged } from '@/core/sse'
import { pluginRegistry } from '@/core/plugin-registry'

function extractPluginId(url: URL): string {
  // /api/plugin-settings/{pluginId}
  const segments = url.pathname.split('/').filter(Boolean)
  return segments[segments.length - 1] || ''
}

export async function get(_req: Request, url: URL): Promise<Response> {
  const pluginId = extractPluginId(url)
  if (!PLUGIN_ID_RE.test(pluginId)) {
    return Response.json({ error: 'Invalid plugin id' }, { status: 400 })
  }
  return Response.json(readPluginSettings(pluginId))
}

export async function put(req: Request, url: URL): Promise<Response> {
  const pluginId = extractPluginId(url)
  if (!PLUGIN_ID_RE.test(pluginId)) {
    return Response.json({ error: 'Invalid plugin id' }, { status: 400 })
  }
  const body = await req.json()
  writePluginSettings(pluginId, body)

  // Notify the plugin of settings change
  pluginRegistry.notifySettingsChange(pluginId, body).catch(() => {})
  broadcastPluginSettingsChanged(pluginId)

  return Response.json({ ok: true })
}
