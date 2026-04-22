/**
 * PluginHost — boots plugins at runtime.
 *
 * On mount:
 *   1. Fetches /api/plugins/manifest (TF1) to get each plugin's client
 *      bundle URL.
 *   2. Dynamic-imports every clientEntry in parallel. Each plugin's
 *      client.mjs runs `registerPlugin({...})` / `registerSlot(...)` as a
 *      side effect — no exports are read.
 *   3. Optionally calls `assertReactInstance(pluginId, pluginReact)` on
 *      each loaded module to catch plugins that bundled their own React
 *      (broken hooks).
 *   4. Flips a `ready` flag to re-render the shell with nav items + slots
 *      populated from the registry.
 *
 * While plugins are loading, children render against the (initially empty)
 * slot/nav registry. That means sidebar nav briefly shows nothing on cold
 * boot — acceptable for a single-user LAN app.
 *
 * Phase G replaces the disk-backed asset route with Bun.embeddedFiles
 * inside the compiled binary; the PluginHost path doesn't change.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { assertReactInstance } from '../lib/react-identity'

interface ManifestPlugin {
  id: string
  name: string
  version: string
  clientEntry: string
}

interface Manifest {
  plugins: ManifestPlugin[]
}

interface LoadedPluginModule {
  React?: unknown
  default?: unknown
}

async function loadPluginClient(plugin: ManifestPlugin): Promise<void> {
  try {
    const mod = await import(/* @vite-ignore */ plugin.clientEntry) as LoadedPluginModule
    // If the plugin exports its React instance (e.g. via `export { React }`
    // or a marker), verify it matches the shell's. Plugins aren't required
    // to expose this — the lack of an export is a non-event.
    if (mod.React) {
      assertReactInstance(plugin.id, mod.React as typeof import('react'))
    }
  } catch (err) {
    // One bad plugin shouldn't prevent the rest from loading. Log + skip.
    console.error(`[bakin] Plugin ${plugin.id} failed to load from ${plugin.clientEntry}:`, err)
  }
}

export function PluginHost({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/plugins/manifest')
        if (!res.ok) {
          console.error('[bakin] Failed to fetch plugin manifest:', res.status, res.statusText)
          if (!cancelled) setReady(true)
          return
        }
        const manifest = (await res.json()) as Manifest
        await Promise.all(manifest.plugins.map(loadPluginClient))
      } catch (err) {
        console.error('[bakin] Plugin host boot failed:', err)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Render children regardless — the slot/nav registry is already being
  // read reactively by the shell. Before `ready`, the sidebar is empty
  // and slots return null for uncontributed names; after, everything
  // flips. We do trigger a re-render by updating state, which is why
  // `ready` exists even though we don't gate rendering on it.
  void ready
  return <>{children}</>
}
