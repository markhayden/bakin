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
 * Re-render on registry change: consumers (<Slot>, <AppSidebar>) subscribe
 * to `getRegistryVersion()` via `useSyncExternalStore` themselves — a
 * single subscription here in PluginHost would re-render PluginHost but
 * not propagate to descendants whose props didn't change. Each consumer
 * that reads the registry owns its own subscription.
 *
 * Dev hot-swap bridge: when the dev-client script is present in the
 * document, PluginHost exposes `window.__bakinHotSwapPlugin(id, clientEntry,
 * version)` so scripts/dev.ts can trigger a per-plugin remount without a
 * full page reload. Production builds never ship the dev client, so the
 * window handle stays undefined there.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { unregisterPlugin } from '@bakin/sdk'
import { assertReactInstance } from '../lib/react-identity'
import {
  installVersionMismatchDetector,
  VERSION_MISMATCH_EVENT,
  type VersionMismatchDetail,
} from './version-mismatch-detector'

interface ManifestPlugin {
  id: string
  name: string
  version: string
  clientEntry?: string
  clientVersion?: string
  clientCss?: string
  status?: 'active' | 'failed'
}

interface Manifest {
  plugins: ManifestPlugin[]
}

interface LoadedPluginModule {
  React?: unknown
  default?: unknown
}

function pluginCssLink(pluginId: string): HTMLLinkElement | null {
  return document.head.querySelector<HTMLLinkElement>(
    `link[data-bakin-plugin-css="${pluginId}"]`,
  )
}

function injectPluginCss(plugin: ManifestPlugin): void {
  if (!plugin.clientCss) return
  if (pluginCssLink(plugin.id)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = plugin.clientCss
  link.setAttribute('data-bakin-plugin-css', plugin.id)
  document.head.appendChild(link)
}

function swapPluginCss(plugin: ManifestPlugin, version: string): void {
  if (!plugin.clientCss) return
  const existing = pluginCssLink(plugin.id)
  const next = document.createElement('link')
  next.rel = 'stylesheet'
  next.href = `${plugin.clientCss}?v=${version}`
  next.setAttribute('data-bakin-plugin-css', plugin.id)
  next.addEventListener('load', () => existing?.remove(), { once: true })
  document.head.appendChild(next)
  if (!existing) {
    // Nothing to replace — treat as a fresh inject.
  }
}

async function loadPluginClient(plugin: ManifestPlugin): Promise<void> {
  if (plugin.status === 'failed' || !plugin.clientEntry) return
  injectPluginCss(plugin)
  const importUrl = plugin.clientVersion
    ? `${plugin.clientEntry}?v=${plugin.clientVersion}`
    : plugin.clientEntry
  try {
    const mod = await import(/* @vite-ignore */ importUrl) as LoadedPluginModule
    // If the plugin exports its React instance (e.g. via `export { React }`
    // or a marker), verify it matches the shell's. Plugins aren't required
    // to expose this — the lack of an export is a non-event.
    if (mod.React) {
      assertReactInstance(plugin.id, mod.React as typeof import('react'))
    }
  } catch (err) {
    // One bad plugin shouldn't prevent the rest from loading. Log + skip.
    console.error(`[bakin] Plugin ${plugin.id} failed to load from ${importUrl}:`, err)
  }
}

// Manifest kept module-scoped so hotSwapPlugin can look up clientCss
// without re-fetching. Populated by PluginHost on mount.
let latestManifest: Manifest | null = null
const hotSwapInFlight = new Map<string, Promise<void>>()
const appliedHotSwapUrls = new Map<string, string>()

async function refreshManifest(): Promise<Manifest | null> {
  try {
    const res = await fetch('/api/plugins/manifest')
    if (!res.ok) return latestManifest
    latestManifest = (await res.json()) as Manifest
  } catch {
    // Keep the last known manifest; hot-swap can still import by URL.
  }
  return latestManifest
}

async function performHotSwap(id: string, clientEntry: string, version: string, importUrl: string): Promise<void> {
  const manifest = await refreshManifest()
  const plugin = manifest?.plugins.find((p) => p.id === id)
  unregisterPlugin(id)
  if (plugin) swapPluginCss(plugin, version)
  await import(/* @vite-ignore */ importUrl)
  appliedHotSwapUrls.set(id, importUrl)
}

async function hotSwapPlugin(id: string, clientEntry: string, version: string): Promise<void> {
  const importUrl = `${clientEntry}?v=${version}`
  if (appliedHotSwapUrls.get(id) === importUrl) return

  const existing = hotSwapInFlight.get(id)
  if (existing) {
    await existing
    if (appliedHotSwapUrls.get(id) === importUrl) return
  }

  const task = performHotSwap(id, clientEntry, version, importUrl)
  hotSwapInFlight.set(id, task)
  try {
    await task
  } finally {
    if (hotSwapInFlight.get(id) === task) hotSwapInFlight.delete(id)
  }
}

function isDevModeActive(): boolean {
  return !!document.querySelector('script[src="/__bakin-dev/client.js"]')
}

export function PluginHost({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const manifest = await refreshManifest()
        if (!manifest) {
          console.error('[bakin] Failed to fetch plugin manifest')
          if (!cancelled) setReady(true)
          return
        }
        await Promise.all(manifest.plugins.map(loadPluginClient))
      } catch (err) {
        console.error('[bakin] Plugin host boot failed:', err)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Expose the hot-swap handle to the dev client. Keyed on the script
  // tag's presence — production builds never have it, so the handle
  // stays undefined and no external caller can reach unregisterPlugin
  // through this bridge.
  useEffect(() => {
    if (!isDevModeActive()) return
    ;(window as unknown as { __bakinHotSwapPlugin?: typeof hotSwapPlugin })
      .__bakinHotSwapPlugin = hotSwapPlugin
    return () => {
      delete (window as unknown as { __bakinHotSwapPlugin?: unknown }).__bakinHotSwapPlugin
    }
  }, [])

  // Install the version-mismatch detector + listen for its events
  // (Phase 2 P2.C6). The detector wraps fetch; on header drift it fires
  // a CustomEvent that we react to by triggering the same hot-swap path
  // SSE events use. Dev-mode only — production never wraps fetch.
  useEffect(() => {
    if (!isDevModeActive()) return
    installVersionMismatchDetector()
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<VersionMismatchDetail>).detail
      if (!detail) return
      const plugin = latestManifest?.plugins.find((p) => p.id === detail.pluginId)
      if (!plugin?.clientEntry) return
      console.info(
        `[bakin] Plugin "${detail.pluginId}" version drifted (${detail.oldVersion} → ${detail.newVersion}); reloading client bundle.`,
      )
      void hotSwapPlugin(detail.pluginId, plugin.clientEntry, String(detail.newVersion))
    }
    window.addEventListener(VERSION_MISMATCH_EVENT, handler)
    return () => window.removeEventListener(VERSION_MISMATCH_EVENT, handler)
  }, [])

  if (!ready) return null
  return <>{children}</>
}
