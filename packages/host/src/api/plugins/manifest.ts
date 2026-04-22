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
import { pluginRegistry } from '@/lib/plugin-registry'

interface ManifestPlugin {
  id: string
  name: string
  version: string
  clientEntry: string
}

interface ManifestResponse {
  plugins: ManifestPlugin[]
}

export async function get(_req: Request): Promise<Response> {
  const plugins: ManifestPlugin[] = []
  for (const entry of pluginRegistry.getRegistrySnapshot()) {
    plugins.push({
      id: entry.id,
      name: entry.name,
      version: entry.version,
      clientEntry: `/api/plugins/${entry.id}/assets/client.js`,
    })
  }

  const body: ManifestResponse = { plugins }
  return Response.json(body)
}
