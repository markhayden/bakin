/**
 * GET/PUT /api/plugin-settings/{pluginId} — per-plugin settings.
 *
 * Migrated from src/app/api/plugin-settings/[pluginId]/route.ts for
 * Phase B of #147. The {pluginId} segment is parsed from url.pathname.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { PLUGIN_ID_RE } from '@bakin/core/plugins/manifest'
import { getContentDir } from '@/core/content-dir'
import { broadcastPluginSettingsChanged } from '@/core/sse'
import { pluginRegistry } from '@/lib/plugin-registry'

function getSettingsPath(pluginId: string): string {
  return join(getContentDir(), 'plugin-settings', `${pluginId}.json`)
}

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
  const path = getSettingsPath(pluginId)
  if (!existsSync(path)) {
    return Response.json({})
  }
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    return Response.json(data)
  } catch {
    return Response.json({})
  }
}

export async function put(req: Request, url: URL): Promise<Response> {
  const pluginId = extractPluginId(url)
  if (!PLUGIN_ID_RE.test(pluginId)) {
    return Response.json({ error: 'Invalid plugin id' }, { status: 400 })
  }
  const body = await req.json()
  const path = getSettingsPath(pluginId)
  const dir = join(getContentDir(), 'plugin-settings')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(path, JSON.stringify(body, null, 2))

  // Notify the plugin of settings change
  pluginRegistry.notifySettingsChange(pluginId, body).catch(() => {})
  broadcastPluginSettingsChanged(pluginId)

  return Response.json({ ok: true })
}
