/**
 * GET /api/plugins/manifest — aggregated plugin manifest for the browser.
 *
 * Returns the list of registered plugins + where to find each one's client
 * bundle. The shell's PluginHost (TF4) fetches this on mount and dynamic-
 * imports every `clientEntry` URL so each plugin's `registerPlugin({...})`
 * side-effect runs.
 *
 * Shape is intentionally minimal for TF1 — the registry knows the plugin's
 * NavItems via the existing navItems PluginState field. Pages + slots are
 * registered by the plugin's `client.mjs` at runtime via `registerPlugin`,
 * so they don't live in the manifest.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { pluginRegistry } from '@/lib/plugin-registry'
import { getContentDir } from '@/core/content-dir'
import { EMBEDDED_ASSETS } from '../_embedded-assets'

interface ManifestPlugin {
  id: string
  name: string
  version: string
  clientEntry: string
  /** Optional stylesheet URL — present only if the plugin build emitted one. */
  clientCss?: string
}

interface ManifestResponse {
  plugins: ManifestPlugin[]
}

/** Resolution mirrors assets.ts: user dir → embedded map → repo dist. */
function hasClientCss(pluginId: string): boolean {
  const relPath = 'client.css'
  if (existsSync(join(getContentDir(), 'plugins', pluginId, 'dist', relPath))) return true
  if (EMBEDDED_ASSETS.has(`/api/plugins/${pluginId}/assets/${relPath}`)) return true
  if (existsSync(join(process.cwd(), 'plugins', pluginId, 'dist', relPath))) return true
  return false
}

export async function get(_req: Request): Promise<Response> {
  const plugins: ManifestPlugin[] = []
  for (const entry of pluginRegistry.getRegistrySnapshot()) {
    const plugin: ManifestPlugin = {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      clientEntry: `/api/plugins/${entry.id}/assets/client.js`,
    }
    if (hasClientCss(entry.id)) {
      plugin.clientCss = `/api/plugins/${entry.id}/assets/client.css`
    }
    plugins.push(plugin)
  }

  const body: ManifestResponse = { plugins }
  return Response.json(body)
}
