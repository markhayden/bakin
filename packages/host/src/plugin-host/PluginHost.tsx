/**
 * PluginHost — boots plugins at runtime, lazily.
 *
 * On mount:
 *   1. Fetches /api/plugins/manifest (TF1) to get each plugin's client
 *      bundle URL + declarative `contributes.{nav,routes,slots,eager}`.
 *   2. Seeds the sidebar from manifest nav (`setManifestNav`) and installs
 *      the lazy ownership index (`configureLazyPlugins`) — all before any
 *      client bundle loads.
 *   3. Dynamic-imports ONLY eager plugins: `contributes.eager: true`
 *      (background providers like nav-badge-providers) and legacy plugins
 *      with a client but no declarative metadata (backward compat). Each
 *      plugin's client.mjs runs `registerPlugin({...})` as a side effect —
 *      no exports are read.
 *   4. Flips a `ready` flag to render the shell. Every other plugin's
 *      client loads on first demand: a `<Slot>` it owns rendering, or
 *      navigation into one of its manifest route patterns (the plugin
 *      route catch-all calls `requestRoutePlugins`).
 *   5. After every client import, a drift check compares the runtime
 *      registrations against the manifest declarations and warns on
 *      mismatch (the lazy contract is only as good as the manifest).
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
 * full page reload. Hot-swapping a plugin whose client never loaded is a
 * metadata-only refresh — the new bundle is picked up by the next demand.
 * Production builds never ship the dev client, so the window handle stays
 * undefined there.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { type PluginContributions } from '@makinbakin/sdk'
import {
  configureLazyPlugins,
  getPluginLoadState,
  setLazyPluginLoader,
  setManifestNav,
  setPluginLoadState,
  unregisterPlugin,
} from '@makinbakin/sdk/internal'
import { Slot } from '@makinbakin/sdk/slots'
import { Button } from '@makinbakin/sdk/ui'
import { assertReactInstance } from '../lib/react-identity'
import { findShadowingHostPaths } from '../lib/route-shadow'
import { checkPluginDrift } from './drift-check'
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
  contributes?: PluginContributions
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
  /** False when the manifest never arrived — the app shell would render blind. */
  manifestOk: boolean
  /** Eager plugins whose bundle import failed or timed out. */
  failedPlugins: string[]
}

export const DEFAULT_MANIFEST_TIMEOUT_MS = 10_000
export const DEFAULT_IMPORT_TIMEOUT_MS = 20_000

/**
 * Boot deadlines (mutable for tests). Without them, a manifest fetch or
 * bundle import that lands on a dying socket (server restart under an open
 * tab) never settles and the shell shows "Loading plugins" forever.
 */
export const PLUGIN_BOOT_TIMEOUTS = {
  manifestMs: DEFAULT_MANIFEST_TIMEOUT_MS,
  importMs: DEFAULT_IMPORT_TIMEOUT_MS,
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
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
    if (path.startsWith('/_app/')) return `app:${path.split('/').pop() ?? 'asset'}`
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

/**
 * True if the manifest declares any of the metadata that makes lazy
 * loading possible. Plugins with a client but none of it are legacy-shaped
 * and load eagerly (old behavior) until migrated.
 */
function hasDeclarativeClientMetadata(plugin: ManifestPlugin): boolean {
  const c = plugin.contributes
  return Boolean(c?.nav?.length || c?.routes?.length || c?.slots?.length)
}

function isLoadablePlugin(plugin: ManifestPlugin): boolean {
  return plugin.status !== 'failed' && Boolean(plugin.clientEntry)
}

/** Eager = explicit `contributes.eager` escape hatch, or legacy shape. */
function isEagerPlugin(plugin: ManifestPlugin): boolean {
  if (!isLoadablePlugin(plugin)) return false
  return plugin.contributes?.eager === true || !hasDeclarativeClientMetadata(plugin)
}

// Plugin ids whose manifest nav we've seeded — so a plugin removed from the
// manifest (dev uninstall + hot reload) gets its sidebar entry cleared on
// the next refresh instead of lingering forever.
const seededManifestNavIds = new Set<string>()

/**
 * Apply a fresh manifest's declarative metadata: sidebar nav + the lazy
 * slot/route ownership index. Runs on boot and after every manifest
 * refresh (hot-swap, version mismatch) so metadata edits land without the
 * client bundle reloading.
 */
function applyManifestMetadata(manifest: Manifest): void {
  const slotOwners = new Map<string, string[]>()
  const routeOwners: Array<{ pattern: string; pluginId: string }> = []
  const presentIds = new Set<string>()

  for (const plugin of manifest.plugins) {
    presentIds.add(plugin.id)
    const loadable = isLoadablePlugin(plugin)
    setManifestNav(plugin.id, loadable ? plugin.contributes?.nav ?? null : null)
    if (loadable && plugin.contributes?.nav?.length) seededManifestNavIds.add(plugin.id)
    if (!loadable) continue
    for (const slot of plugin.contributes?.slots ?? []) {
      const owners = slotOwners.get(slot) ?? []
      owners.push(plugin.id)
      slotOwners.set(slot, owners)
    }
    for (const route of plugin.contributes?.routes ?? []) {
      // A pattern colliding with a host route can never render — every
      // explicit host route outranks the `$` splat this pattern lives under.
      const shadowedBy = findShadowingHostPaths(route.path)
      if (shadowedBy.length > 0) {
        console.warn(
          `[bakin] plugin "${plugin.id}" route "${route.path}" is shadowed by host route(s) ${shadowedBy.map((p) => `"${p}"`).join(', ')} and will never render there.`,
        )
      }
      routeOwners.push({ pattern: route.path, pluginId: plugin.id })
    }
  }

  for (const id of seededManifestNavIds) {
    if (presentIds.has(id)) continue
    setManifestNav(id, null)
    seededManifestNavIds.delete(id)
  }

  configureLazyPlugins({ slotOwners, routeOwners })
}

/**
 * Compare a freshly-loaded client's runtime registrations against its
 * manifest declarations. Drift means lazy loading misbehaves (routes that
 * 404 until an unrelated demand, nav that only exists after load), so the
 * warnings are unconditional — this is an authoring bug, not noise.
 */
function runDriftCheck(plugin: ManifestPlugin): void {
  const warnings = checkPluginDrift(plugin.id, plugin.contributes)
  for (const warning of warnings) {
    console.warn(`[bakin] plugin "${plugin.id}" manifest drift: ${warning}`)
  }
  if (warnings.length > 0) {
    debugPluginStartup('pluginHost.driftCheck', {
      pluginId: plugin.id,
      status: 'drift',
      count: warnings.length,
      warnings,
    })
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
  // Mark loading synchronously (before the first await) so a second demand
  // arriving in the same tick can't double-import the bundle.
  setPluginLoadState(plugin.id, 'loading')
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
    const mod = await withTimeout(
      import(/* @vite-ignore */ importUrl),
      PLUGIN_BOOT_TIMEOUTS.importMs,
      `plugin "${plugin.id}" bundle import`,
    ) as LoadedPluginModule
    // If the plugin exports its React instance (e.g. via `export { React }`
    // or a marker), verify it matches the shell's. Plugins aren't required
    // to expose this — the lack of an export is a non-event.
    if (mod.React) {
      assertReactInstance(plugin.id, mod.React as typeof import('react'))
    }
    setPluginLoadState(plugin.id, 'loaded')
    debugPluginStartup('pluginHost.clientImport', {
      pluginId: plugin.id,
      status: 'ok',
      durationMs: roundedMs(nowMs() - startedAt),
    })
    runDriftCheck(plugin)
  } catch (err) {
    // One bad plugin shouldn't prevent the rest from loading. Log + skip;
    // the error state surfaces through <Slot> / catch-all fallbacks, which
    // offer a retry.
    console.error(`[bakin] Plugin ${plugin.id} failed to load from ${importUrl}:`, err)
    setPluginLoadState(plugin.id, 'error', err instanceof Error ? err.message : String(err))
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
    // Bounded: a fetch on a dying socket (server restart) can otherwise
    // hang forever and pin the boot spinner.
    const res = await fetch('/api/plugins/manifest', {
      signal: AbortSignal.timeout(PLUGIN_BOOT_TIMEOUTS.manifestMs),
    })
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
  // Re-apply declarative metadata so manifest edits (nav, slot/route
  // ownership) land with the swap, not just code changes.
  if (manifest) applyManifestMetadata(manifest)
  // A declaratively-lazy plugin whose client never loaded has nothing to
  // swap: the refreshed manifest carries the new clientVersion, so the next
  // demand imports the new bundle. Record the URL so repeat SSE events for
  // the same build stay deduped. Legacy/eager plugins (and ids outside the
  // manifest, as the hot-swap tests use) keep the old always-import path.
  const isUnloadedLazy = plugin !== undefined
    && isLoadablePlugin(plugin)
    && !isEagerPlugin(plugin)
    && getPluginLoadState(id) === 'idle'
  if (isUnloadedLazy) {
    appliedHotSwapUrls.set(id, importUrl)
    return
  }
  unregisterPlugin(id)
  if (plugin) swapPluginCss(plugin, version)
  setPluginLoadState(id, 'loading')
  try {
    await withTimeout(
      import(/* @vite-ignore */ importUrl),
      PLUGIN_BOOT_TIMEOUTS.importMs,
      `plugin "${id}" hot-swap import`,
    )
  } catch (err) {
    setPluginLoadState(id, 'error', err instanceof Error ? err.message : String(err))
    throw err
  }
  setPluginLoadState(id, 'loaded')
  appliedHotSwapUrls.set(id, importUrl)
  if (plugin) runDriftCheck(plugin)
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
  let lazyCount = 0
  let manifestOk = true
  const failedPlugins: string[] = []
  try {
    const manifest = await refreshManifest()
    if (!manifest) {
      console.error('[bakin] Failed to fetch plugin manifest')
      status = 'error'
      manifestOk = false
      return { status, count, manifestOk, failedPlugins }
    }
    // Declarative metadata first: sidebar nav + lazy ownership index exist
    // before (and regardless of) any client bundle loading.
    applyManifestMetadata(manifest)
    const eagerPlugins = manifest.plugins.filter(isEagerPlugin)
    count = eagerPlugins.length
    lazyCount = manifest.plugins.filter((p) => isLoadablePlugin(p) && !isEagerPlugin(p)).length
    await Promise.all(eagerPlugins.map(loadPluginClient))
    // loadPluginClient never rejects — failures land in the load-state store.
    for (const plugin of eagerPlugins) {
      if (getPluginLoadState(plugin.id) === 'error') failedPlugins.push(plugin.id)
    }
  } catch (err) {
    status = 'error'
    console.error('[bakin] Plugin host boot failed:', err)
  } finally {
    const endedAt = nowMs()
    debugPluginStartup('pluginHost.boot', {
      status,
      durationMs: roundedMs(endedAt - startedAt),
      count,
      lazyCount,
    })
    logStartupResourceSummary(startedAt, endedAt)
  }
  return { status, count, manifestOk, failedPlugins }
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

/** Retry after a failed boot: drop the (settled) in-flight promise and go again. */
function restartPluginBoot(): Promise<PluginBootResult> {
  pluginBootInFlight = null
  return acquirePluginBoot()
}

/** Tests only: clear module-scoped boot state (manifest cache + in-flight boot). */
export function __resetPluginBootForTests(): void {
  latestManifest = null
  pluginBootInFlight = null
  pluginBootConsumers = 0
  pluginBootReleaseQueued = false
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
    <div className="fixed inset-0 flex items-center justify-center bg-bakin-canvas-default text-bakin-text-primary" role="status" aria-live="polite">
      <div className="flex items-center gap-3.5 text-sm text-bakin-text-muted">
        <span className="size-7 animate-spin rounded-bakin-pill border-3 border-bakin-signal-accent/20 border-t-bakin-signal-accent" aria-hidden="true" />
        <span className="leading-none">
          Loading plugins
        </span>
      </div>
    </div>
  )
}

function BootErrorPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-bakin-canvas-default text-bakin-text-primary" role="alert" data-testid="plugin-boot-error">
      <div className="flex max-w-md flex-col items-center gap-bakin-4 text-center">
        <div className="text-sm font-bakin-typography-weight-medium">Couldn&apos;t load plugins</div>
        <p className="text-sm text-bakin-text-muted">
          The server didn&apos;t answer the plugin manifest request. It may be
          restarting — retry in a moment, or check that Bakin is running.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  )
}

function PluginFailureBanner({ pluginIds, onDismiss }: { pluginIds: string[]; onDismiss: () => void }) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-bakin-4 border-t border-bakin-border-subtle/30 bg-bakin-canvas-default px-bakin-4 py-2.5 text-sm"
      role="alert"
      data-testid="plugin-boot-failures"
    >
      <span className="text-bakin-text-muted">
        {pluginIds.length === 1 ? 'A plugin' : `${pluginIds.length} plugins`} failed to load:{' '}
        <span className="font-bakin-typography-weight-medium text-bakin-text-primary">{pluginIds.join(', ')}</span> — features they
        provide are missing. See the browser console for details.
      </span>
      <span className="flex shrink-0 items-center gap-bakin-2">
        <Button type="button" variant="outline" size="xs" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-bakin-text-muted hover:text-bakin-text-primary"
        >
          Dismiss
        </Button>
      </span>
    </div>
  )
}

export function PluginHost({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<PluginBootResult | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [failuresDismissed, setFailuresDismissed] = useState(false)

  // Not a fetch: gates readiness on the module-level plugin boot promise.
  // `attempt` re-runs it after a failed-manifest retry.
  useEffect(() => {
    let cancelled = false
    setBoot(null)
    const bootPromise = attempt === 0 ? acquirePluginBoot() : restartPluginBoot()
    ;(async () => {
      const result = await bootPromise
      if (!cancelled) setBoot(result)
    })()
    return () => {
      cancelled = true
      releasePluginBoot()
    }
  }, [attempt])
  const ready = boot !== null

  // Install the lazy demand loader: <Slot> and the plugin route catch-all
  // request a plugin id on first render of something it owns; we resolve it
  // against the latest manifest and import its client bundle. The lazy
  // store filters non-idle plugins, so this never double-imports.
  useEffect(() => {
    setLazyPluginLoader((pluginId) => {
      const plugin = latestManifest?.plugins.find((p) => p.id === pluginId)
      if (!plugin) return
      void loadPluginClient(plugin)
    })
    return () => setLazyPluginLoader(null)
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
  // No manifest = the shell would render blind (no nav, no routes, no
  // slots). Show an honest error with retry instead of a broken app.
  if (!boot.manifestOk) {
    return <BootErrorPanel onRetry={() => setAttempt((n) => n + 1)} />
  }
  // Plugins can contribute background hook runners (rendered null,
  // mounted purely so their hooks run while the plugin is registered)
  // via the well-known `nav-badge-providers` slot. Currently used by
  // messaging's PlansBadgeProvider; available to any plugin that needs
  // to keep registry state live without a visible UI surface.
  return (
    <>
      {children}
      <Slot name="nav-badge-providers" />
      {boot.failedPlugins.length > 0 && !failuresDismissed && (
        <PluginFailureBanner
          pluginIds={boot.failedPlugins}
          onDismiss={() => setFailuresDismissed(true)}
        />
      )}
    </>
  )
}
