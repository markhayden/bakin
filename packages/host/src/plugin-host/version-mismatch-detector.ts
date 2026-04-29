/**
 * Client-side version-mismatch detector (Phase 2 P2.C6).
 *
 * Wraps `window.fetch` to inspect the `X-Bakin-Plugin-Version` response
 * header that the server-side stamping middleware (P2.C5) attaches to
 * every response from `/api/plugins/<id>/*`. The detector keeps a
 * per-plugin "last seen version" map; when a response surfaces a
 * different version than what we last knew, it fires a custom
 * `bakin:plugin-version-mismatch` event on `window`.
 *
 * The reload mechanics in PluginHost (P2.C9) listen for that event and
 * invoke `hotSwapPlugin(...)`. The detector itself is intentionally
 * pipeline-agnostic so it stays cheap to test and reason about — its
 * single job is "compare a header, fire an event."
 *
 * SSE events from the coordinator (P2.C8) are the primary path for
 * triggering reloads. The detector is the safety net: when an SSE event
 * is missed (browser tab in background, network blip), the next
 * server-bound fetch surfaces the version drift and triggers reload
 * anyway. Belt + suspenders.
 *
 * Detector is only installed in dev-mode contexts — production builds
 * skip the install entirely since hot-reload is dev-only.
 */

const HEADER_NAME = 'X-Bakin-Plugin-Version'

const PLUGIN_PATH_REGEX = /^\/api\/plugins\/([a-z][a-z0-9-]{0,39})(?:\/|$)/

const KNOWN_PATHS_TO_IGNORE = new Set<string>([
  '/api/plugins/manifest',
  '/api/plugins/install',
  '/api/plugins/remove',
  '/api/plugins/upgrade',
  '/api/plugins/link',
  '/api/plugins/unlink',
])

export interface VersionMismatchDetail {
  pluginId: string
  oldVersion: number
  newVersion: number
}

export const VERSION_MISMATCH_EVENT = 'bakin:plugin-version-mismatch'

interface DetectorState {
  installed: boolean
  versions: Map<string, number>
  /** Saved reference to the original fetch so uninstall can restore it. */
  originalFetch?: typeof fetch
}

const g = globalThis as unknown as { __bakinVersionDetector?: DetectorState }

function getState(): DetectorState {
  if (!g.__bakinVersionDetector) {
    g.__bakinVersionDetector = { installed: false, versions: new Map() }
  }
  return g.__bakinVersionDetector
}

/**
 * Read + parse the `X-Bakin-Plugin-Version` header. Returns null when
 * the header is absent or malformed — callers should treat that as "no
 * info, leave state unchanged" rather than as a reset signal.
 */
export function parseVersionHeader(value: string | null): { pluginId: string; version: number } | null {
  if (!value) return null
  const colon = value.indexOf(':')
  if (colon <= 0 || colon === value.length - 1) return null
  const pluginId = value.slice(0, colon)
  const versionStr = value.slice(colon + 1)
  const version = Number.parseInt(versionStr, 10)
  if (!Number.isFinite(version) || String(version) !== versionStr) return null
  return { pluginId, version }
}

/**
 * Extract the plugin id from a request URL — only when it points at the
 * plugin catch-all or a plugin asset. Lifecycle endpoints
 * (/api/plugins/install etc.) don't dispatch through a plugin and
 * therefore don't carry a per-plugin version; ignore them.
 */
function pluginIdFromUrl(url: URL): string | null {
  if (KNOWN_PATHS_TO_IGNORE.has(url.pathname)) return null
  const match = url.pathname.match(PLUGIN_PATH_REGEX)
  return match ? match[1] : null
}

function resolveRequestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === 'string') return new URL(input, window.location.origin)
    if (input instanceof URL) return input
    return new URL(input.url, window.location.origin)
  } catch {
    return null
  }
}

/**
 * Compare a response's plugin version header against the known map.
 * Returns the mismatch detail when reload is warranted, null otherwise.
 *
 * Exported for tests so the detection logic can be exercised without
 * monkey-patching globalThis.fetch.
 */
export function detectMismatch(
  expectedPluginId: string,
  headerValue: string | null,
  versions: Map<string, number>,
): VersionMismatchDetail | null {
  const parsed = parseVersionHeader(headerValue)
  if (!parsed) return null
  if (parsed.pluginId !== expectedPluginId) return null

  const known = versions.get(parsed.pluginId)
  // First time we've seen this plugin's version → seed without firing.
  // The boot-time client.js fetch establishes the baseline; only later
  // drift triggers a reload event.
  if (known === undefined) {
    versions.set(parsed.pluginId, parsed.version)
    return null
  }
  if (known === parsed.version) return null

  versions.set(parsed.pluginId, parsed.version)
  return { pluginId: parsed.pluginId, oldVersion: known, newVersion: parsed.version }
}

/** Reset the in-memory version table. Test-only; the detector keeps it
 * monotonic in production. */
export function __resetDetectorForTest(): void {
  const state = getState()
  state.versions.clear()
  if (state.installed && state.originalFetch && typeof globalThis.fetch !== 'undefined') {
    globalThis.fetch = state.originalFetch
    state.installed = false
    state.originalFetch = undefined
  }
}

/**
 * Install the detector by wrapping `globalThis.fetch`. Idempotent —
 * subsequent calls are no-ops. Fires `bakin:plugin-version-mismatch`
 * CustomEvents on `window` whenever a response's version header drifts
 * from the recorded value.
 */
export function installVersionMismatchDetector(): void {
  const state = getState()
  if (state.installed) return
  if (typeof globalThis.fetch !== 'function') return

  const original = globalThis.fetch.bind(globalThis)
  state.originalFetch = original
  state.installed = true

  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await original(input, init)
    try {
      const url = resolveRequestUrl(input)
      if (!url) return response
      const pluginId = pluginIdFromUrl(url)
      if (!pluginId) return response
      const headerValue = response.headers.get(HEADER_NAME)
      const mismatch = detectMismatch(pluginId, headerValue, state.versions)
      if (mismatch && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(
          new CustomEvent<VersionMismatchDetail>(VERSION_MISMATCH_EVENT, { detail: mismatch }),
        )
      }
    } catch {
      // Detector must never break the user's fetch — swallow inspection errors.
    }
    return response
  }
  // Bun's `typeof fetch` requires the static `preconnect` method; copy
  // it across so the runtime + types stay happy.
  ;(wrapped as unknown as { preconnect?: unknown }).preconnect =
    (original as unknown as { preconnect?: unknown }).preconnect
  globalThis.fetch = wrapped as unknown as typeof globalThis.fetch
}
