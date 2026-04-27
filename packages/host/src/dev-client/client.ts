/**
 * Bakin dev client (v2).
 *
 * Injected into index.html by _static.ts when BAKIN_DEV=1. Opens an
 * EventSource on /api/dev/events and dispatches incoming DevEvents:
 *
 *   dev:ready     — log once on connect
 *   dev:building  — (no-op — the DX cost of a building-indicator ribbon
 *                   outweighed the signal, since rebuilds are <2s)
 *   dev:css       — hot-swap the <link rel="stylesheet" href="/globals.css">
 *                   with a cache-busted href, preserve JS state, no reload
 *   dev:reload    — location.reload()
 *   dev:hot-swap  — call window.__bakinHotSwapPlugin(id, clientEntry, version)
 *                   from PluginHost. Failure falls back to location.reload().
 *                   Safety valve: after 100 hot-swaps per tab session, force
 *                   a location.reload() to clear the browser's ES module
 *                   cache (see .claude/knowledge/dev-loop.md for the
 *                   passive-caching math).
 *   dev:error     — render a fixed-position overlay at the top of the viewport
 *   dev:recover   — dismiss the overlay
 */
interface DevErrorEvent {
  type: 'dev:error'
  scope: string
  message: string
  stderr?: string
}

interface DevHotSwapEvent {
  type: 'dev:hot-swap'
  scope: 'plugin'
  id: string
  version: string
}

// Phase 2 P2.C9 — events broadcast by the in-process hot-reload
// coordinator (server-side hot-reload via `bakin plugins link`).
// Distinct from dev:hot-swap (which scripts/dev.ts emits for repo
// core-plugin rebuilds) — same client behavior, different upstream.
interface PluginReloadEvent {
  type: 'dev:plugin:reload'
  pluginId: string
  version: number
  hasClientCss?: boolean
}
interface PluginErrorEvent {
  type: 'dev:plugin:error'
  pluginId: string
  message: string
  stderr?: string
}
interface PluginRecoverEvent {
  type: 'dev:plugin:recover'
  pluginId: string
}

type HotSwapFn = (id: string, clientEntry: string, version: string) => Promise<void>

const OVERLAY_ID = '__bakin-dev-overlay'
const STDERR_MAX = 4096
const HOTSWAP_COUNTER_KEY = 'bakin-dev-hotswap-count'
const HOTSWAP_RELOAD_THRESHOLD = 100
const HOTSWAP_DEBOUNCE_MS = 100

const es = new EventSource('/api/dev/events')

es.addEventListener('open', () => {
  console.log('[bakin-dev] connected')
})

es.addEventListener('error', () => {
  console.warn('[bakin-dev] EventSource error — will auto-reconnect')
})

es.addEventListener('message', (ev: MessageEvent<string>) => {
  let event: { type: string } & Record<string, unknown>
  try {
    event = JSON.parse(ev.data)
  } catch {
    return
  }

  switch (event.type) {
    case 'dev:ready':
      break
    case 'dev:building':
      break
    case 'dev:css':
      swapCss()
      break
    case 'dev:reload':
      location.reload()
      break
    case 'dev:hot-swap':
      scheduleHotSwap(event as unknown as DevHotSwapEvent)
      break
    case 'dev:error':
      renderOverlay(event as unknown as DevErrorEvent)
      break
    case 'dev:recover':
      dismissOverlay()
      break
    case 'dev:plugin:reload': {
      // Server-side hot-reload coordinator (P2.C8) succeeded — re-fetch
      // and remount this plugin's client bundle. Routes through the
      // same hot-swap path scripts/dev.ts uses for core plugins.
      const e = event as unknown as PluginReloadEvent
      scheduleHotSwap({
        type: 'dev:hot-swap',
        scope: 'plugin',
        id: e.pluginId,
        version: String(e.version),
      })
      break
    }
    case 'dev:plugin:error': {
      const e = event as unknown as PluginErrorEvent
      renderOverlay({
        type: 'dev:error',
        scope: `plugin:${e.pluginId}`,
        message: e.message,
        ...(e.stderr ? { stderr: e.stderr } : {}),
      })
      break
    }
    case 'dev:plugin:recover':
      dismissOverlay()
      break
  }
})

// Debounced hot-swap queue: multiple dev:hot-swap events for the same
// plugin id within HOTSWAP_DEBOUNCE_MS collapse to one remount using
// the latest version string.
const hotSwapTimers = new Map<string, ReturnType<typeof setTimeout>>()
const hotSwapLatest = new Map<string, DevHotSwapEvent>()

function scheduleHotSwap(event: DevHotSwapEvent): void {
  hotSwapLatest.set(event.id, event)
  const existing = hotSwapTimers.get(event.id)
  if (existing) clearTimeout(existing)
  hotSwapTimers.set(event.id, setTimeout(() => {
    hotSwapTimers.delete(event.id)
    const latest = hotSwapLatest.get(event.id)
    hotSwapLatest.delete(event.id)
    if (latest) runHotSwap(latest)
  }, HOTSWAP_DEBOUNCE_MS))
}

async function runHotSwap(event: DevHotSwapEvent): Promise<void> {
  const swapFn = (window as unknown as { __bakinHotSwapPlugin?: HotSwapFn }).__bakinHotSwapPlugin
  if (typeof swapFn !== 'function') {
    console.warn('[bakin-dev] hot-swap handle missing — falling back to reload')
    location.reload()
    return
  }

  // Safety-valve reload: browsers have no import cache eviction API, so
  // every hot-swap adds a cached module keyed on ?v=<hash>. After 100
  // swaps we force a reload to clear the cache — the user is about to
  // save again anyway and won't notice.
  const count = Number(sessionStorage.getItem(HOTSWAP_COUNTER_KEY) ?? '0') + 1
  if (count >= HOTSWAP_RELOAD_THRESHOLD) {
    sessionStorage.setItem(HOTSWAP_COUNTER_KEY, '0')
    location.reload()
    return
  }
  sessionStorage.setItem(HOTSWAP_COUNTER_KEY, String(count))

  try {
    const clientEntry = `/api/plugins/${event.id}/assets/client.js`
    await swapFn(event.id, clientEntry, event.version)
  } catch (err) {
    console.error(`[bakin-dev] hot-swap failed for ${event.id}, falling back to reload:`, err)
    location.reload()
  }
}

function swapCss(): void {
  const links = document.querySelectorAll<HTMLLinkElement>(
    'link[rel="stylesheet"][href^="/globals.css"], link[rel="stylesheet"][href="/globals.css"]',
  )
  for (const oldLink of Array.from(links)) {
    const next = oldLink.cloneNode(false) as HTMLLinkElement
    next.href = `/globals.css?v=${Date.now()}`
    next.addEventListener('load', () => {
      oldLink.remove()
    }, { once: true })
    oldLink.parentNode?.insertBefore(next, oldLink.nextSibling)
  }
}

function renderOverlay(event: DevErrorEvent): void {
  dismissOverlay()
  const overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  overlay.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'right:0',
    'background:#7c1d1d',
    'color:#fff',
    'font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
    'padding:12px 16px',
    'white-space:pre',
    'overflow-y:auto',
    'max-height:50vh',
    'z-index:2147483647',
    'cursor:pointer',
    'box-shadow:0 4px 12px rgba(0,0,0,0.4)',
  ].join(';')

  const stderr = event.stderr && event.stderr.length > STDERR_MAX
    ? event.stderr.slice(0, STDERR_MAX) + '\n... (truncated)'
    : event.stderr ?? ''
  overlay.textContent = `${event.scope} build failed\n\n${event.message}${stderr ? '\n\n' + stderr : ''}\n\n(click to dismiss)`

  overlay.addEventListener('click', dismissOverlay)
  document.body.appendChild(overlay)
}

function dismissOverlay(): void {
  const existing = document.getElementById(OVERLAY_ID)
  if (existing) existing.remove()
}

export {}
