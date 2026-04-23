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
 * Children don't render until every plugin has finished loading. The nav +
 * slot registries read from globalThis at render time and don't subscribe
 * to changes, so rendering the shell before plugins register would leave
 * the sidebar empty and every `<Slot name="page:/..." />` would return null
 * — and React would not re-render them when plugins finally finish loading.
 * A ~200ms blank shell on cold boot is fine for a single-user LAN app.
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
  clientCss?: string
}

interface Manifest {
  plugins: ManifestPlugin[]
}

interface LoadedPluginModule {
  React?: unknown
  default?: unknown
}

function injectPluginCss(plugin: ManifestPlugin): void {
  if (!plugin.clientCss) return
  const attr = `data-bakin-plugin-css="${plugin.id}"`
  if (document.head.querySelector(`link[${attr}]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = plugin.clientCss
  link.setAttribute('data-bakin-plugin-css', plugin.id)
  document.head.appendChild(link)
}

async function loadPluginClient(plugin: ManifestPlugin): Promise<void> {
  injectPluginCss(plugin)
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

  if (!ready) return null
  return <>{children}</>
}
