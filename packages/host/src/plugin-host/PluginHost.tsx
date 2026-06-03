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
import { unregisterPlugin } from '@makinbakin/sdk'
import { Slot } from '@makinbakin/sdk/slots'
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

interface PluginBootResult {
  status: 'ok' | 'error'
  count: number
}

interface StartupResourceTiming {
  resource: string
  initiatorType: string
  durationMs: number
  startMs: number
  transferBytes?: number
  encodedBytes?: number
  decodedBytes?: number
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function roundedMs(value: number): number {
  return Math.round(value * 100) / 100
}

function pluginDiagnosticsEnabled(): boolean {
  if (isDevModeActive()) return true
  try {
    if (window.localStorage?.getItem('bakin:plugin-diagnostics') === '1') return true
    const url = new URL(window.location.href)
    return url.searchParams.get('bakinPluginDiagnostics') === '1'
  } catch {
    return false
  }
}

function debugPluginStartup(span: string, data: Record<string, unknown>): void {
  if (!pluginDiagnosticsEnabled()) return
  const event = {
    category: 'startup',
    phase: 'browser-plugin-host',
    span,
    ...data,
  }
  try {
    const win = window as unknown as { __bakinStartupSpans?: Array<Record<string, unknown>> }
    const spans = win.__bakinStartupSpans ?? []
    if (spans.length >= 200) spans.shift()
    spans.push(event)
    win.__bakinStartupSpans = spans
  } catch {
    // Diagnostics are best-effort and should never affect plugin boot.
  }
  console.debug('[bakin] startup span', event)
}

function resourceNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : undefined
}

function startupResourceLabel(name: string): string {
  try {
    const url = new URL(name, window.location.href)
    const path = url.pathname
    const pluginAsset = path.match(/^\/api\/plugins\/([^/]+)\/assets\/([^/]+)$/)
    if (pluginAsset) return `plugin:${pluginAsset[1]}:${pluginAsset[2]}`
    if (path.startsWith('/assets/')) return `app:${path.split('/').pop() ?? 'asset'}`
    if (path.startsWith('/node_modules/')) return 'node_modules'
    if (path.startsWith('/src/')) return 'src'
    if (path.startsWith('/packages/')) return 'packages'
    if (path.startsWith('/plugins/')) return 'plugins'
    if (path.startsWith('/@')) return path.split('/').slice(0, 2).join('/')
    return path || url.protocol.replace(':', '')
  } catch {
    return 'unknown'
  }
}

function logStartupResourceSummary(startedAt: number, endedAt: number): void {
  if (!pluginDiagnosticsEnabled()) return
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return

  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  const resources: StartupResourceTiming[] = entries
    .filter((entry) => {
      if (!Number.isFinite(entry.startTime)) return false
      const responseEnd = Number.isFinite(entry.responseEnd)
        ? entry.responseEnd
        : entry.startTime + entry.duration
      return responseEnd >= startedAt - 5 && entry.startTime <= endedAt + 5
    })
    .map((entry) => {
      const timing: StartupResourceTiming = {
        resource: startupResourceLabel(entry.name),
        initiatorType: entry.initiatorType || 'unknown',
        durationMs: roundedMs(entry.duration),
        startMs: roundedMs(entry.startTime),
      }
      const transferBytes = resourceNumber(entry.transferSize)
      const encodedBytes = resourceNumber(entry.encodedBodySize)
      const decodedBytes = resourceNumber(entry.decodedBodySize)
      if (transferBytes !== undefined) timing.transferBytes = transferBytes
      if (encodedBytes !== undefined) timing.encodedBytes = encodedBytes
      if (decodedBytes !== undefined) timing.decodedBytes = decodedBytes
      return timing
    })

  if (resources.length === 0) return

  const slowest = [...resources]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 10)

  debugPluginStartup('pluginHost.resourceSummary', {
    status: 'ok',
    count: resources.length,
    totalResourceDurationMs: roundedMs(resources.reduce((sum, entry) => sum + entry.durationMs, 0)),
    totalTransferBytes: resources.reduce((sum, entry) => sum + (entry.transferBytes ?? 0), 0),
    slowest,
  })
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
  if (plugin.status === 'failed' || !plugin.clientEntry) {
    debugPluginStartup('pluginHost.clientImport', {
      pluginId: plugin.id,
      status: 'skipped',
      durationMs: 0,
      reason: plugin.status === 'failed' ? 'failed-plugin' : 'missing-client-entry',
    })
    return
  }
  const cssStartedAt = nowMs()
  injectPluginCss(plugin)
  if (plugin.clientCss) {
    debugPluginStartup('pluginHost.cssInject', {
      pluginId: plugin.id,
      status: 'ok',
      durationMs: roundedMs(nowMs() - cssStartedAt),
    })
  }
  const importUrl = plugin.clientVersion
    ? `${plugin.clientEntry}?v=${plugin.clientVersion}`
    : plugin.clientEntry
  const startedAt = nowMs()
  try {
    const mod = await import(/* @vite-ignore */ importUrl) as LoadedPluginModule
    // If the plugin exports its React instance (e.g. via `export { React }`
    // or a marker), verify it matches the shell's. Plugins aren't required
    // to expose this — the lack of an export is a non-event.
    if (mod.React) {
      assertReactInstance(plugin.id, mod.React as typeof import('react'))
    }
    debugPluginStartup('pluginHost.clientImport', {
      pluginId: plugin.id,
      status: 'ok',
      durationMs: roundedMs(nowMs() - startedAt),
    })
  } catch (err) {
    // One bad plugin shouldn't prevent the rest from loading. Log + skip.
    console.error(`[bakin] Plugin ${plugin.id} failed to load from ${importUrl}:`, err)
    debugPluginStartup('pluginHost.clientImport', {
      pluginId: plugin.id,
      status: 'error',
      durationMs: roundedMs(nowMs() - startedAt),
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Manifest kept module-scoped so hotSwapPlugin can look up clientCss
// without re-fetching. Populated by PluginHost on mount.
let latestManifest: Manifest | null = null
const hotSwapInFlight = new Map<string, Promise<void>>()
const appliedHotSwapUrls = new Map<string, string>()

async function refreshManifest(): Promise<Manifest | null> {
  const startedAt = nowMs()
  try {
    const res = await fetch('/api/plugins/manifest')
    if (!res.ok) {
      debugPluginStartup('pluginHost.manifestFetch', {
        status: 'error',
        durationMs: roundedMs(nowMs() - startedAt),
        statusCode: res.status,
      })
      return latestManifest
    }
    latestManifest = (await res.json()) as Manifest
    debugPluginStartup('pluginHost.manifestFetch', {
      status: 'ok',
      durationMs: roundedMs(nowMs() - startedAt),
      count: latestManifest.plugins.length,
    })
  } catch {
    debugPluginStartup('pluginHost.manifestFetch', {
      status: 'error',
      durationMs: roundedMs(nowMs() - startedAt),
    })
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

let pluginBootInFlight: Promise<PluginBootResult> | null = null
let pluginBootConsumers = 0
let pluginBootReleaseQueued = false

async function bootPluginClients(): Promise<PluginBootResult> {
  const startedAt = nowMs()
  let status: 'ok' | 'error' = 'ok'
  let count = 0
  try {
    const manifest = await refreshManifest()
    if (!manifest) {
      console.error('[bakin] Failed to fetch plugin manifest')
      status = 'error'
      return { status, count }
    }
    count = manifest.plugins.length
    await Promise.all(manifest.plugins.map(loadPluginClient))
  } catch (err) {
    status = 'error'
    console.error('[bakin] Plugin host boot failed:', err)
  } finally {
    const endedAt = nowMs()
    debugPluginStartup('pluginHost.boot', {
      status,
      durationMs: roundedMs(endedAt - startedAt),
      count,
    })
    logStartupResourceSummary(startedAt, endedAt)
  }
  return { status, count }
}

function startPluginBoot(): Promise<PluginBootResult> {
  if (!pluginBootInFlight) {
    pluginBootInFlight = bootPluginClients().finally(() => {
      pluginBootInFlight = null
    })
  }
  return pluginBootInFlight
}

function acquirePluginBoot(): Promise<PluginBootResult> {
  pluginBootConsumers += 1
  pluginBootReleaseQueued = false
  return startPluginBoot()
}

function releasePluginBoot(): void {
  pluginBootConsumers = Math.max(0, pluginBootConsumers - 1)
  if (pluginBootConsumers > 0 || pluginBootReleaseQueued) return
  pluginBootReleaseQueued = true
  queueMicrotask(() => {
    pluginBootReleaseQueued = false
    if (pluginBootConsumers === 0) pluginBootInFlight = null
  })
}

function AppBootLoader() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background text-foreground" role="status" aria-live="polite">
      <div className="flex items-center gap-3.5 text-sm text-muted-foreground">
        <span className="size-7 animate-spin rounded-full border-[3px] border-[#ff4d94]/20 border-t-[#ff4d94]" aria-hidden="true" />
        <span className="leading-none">
          Loading plugins
        </span>
      </div>
    </div>
  )
}

export function PluginHost({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const boot = acquirePluginBoot()
    ;(async () => {
      await boot
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
      releasePluginBoot()
    }
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

  if (!ready) return <AppBootLoader />
  // Plugins can contribute background hook runners (rendered null,
  // mounted purely so their hooks run while the plugin is registered)
  // via the well-known `nav-badge-providers` slot. Currently used by
  // messaging's PlansBadgeProvider; available to any plugin that needs
  // to keep registry state live without a visible UI surface.
  return (
    <>
      {children}
      <Slot name="nav-badge-providers" />
    </>
  )
}
