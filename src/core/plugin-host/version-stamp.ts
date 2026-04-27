/**
 * Per-plugin monotonic version registry + response-stamping middleware
 * (Phase 2 P2.C5).
 *
 * The version is bumped by the hot-reload pipeline (P2.C7) every time a
 * plugin's server-side module is swapped. The browser observes the
 * version through the `X-Bakin-Plugin-Version` response header. When the
 * client-side detector (P2.C6) sees a header version higher than what
 * it last knew, it triggers a re-fetch of the plugin's client bundle —
 * the safety net for the case where an SSE event is missed (network
 * blip, browser tab in background, etc).
 *
 * Versioning is in-memory and per-process: a server restart resets every
 * plugin's version to 0. That's fine — on first response after restart,
 * the client either sees v=0 (matches its local default) or detects a
 * version regression and forces a hard reload (the "version went down"
 * branch is the same code path as "version went up").
 *
 * State is stored on `globalThis` so every module evaluation (server
 * entry, plugin handlers, runtime-imported plugin bundles) sees the
 * same registry — same trick used by `src/core/sse.ts`.
 */

const g = globalThis as unknown as {
  __bakinPluginVersions?: Map<string, number>
}

const versions: Map<string, number> = g.__bakinPluginVersions ?? (g.__bakinPluginVersions = new Map())

/** Get the current monotonic version for a plugin id. Defaults to 0. */
export function getVersion(pluginId: string): number {
  return versions.get(pluginId) ?? 0
}

/**
 * Increment a plugin's version and return the new value. Called by the
 * reload pipeline after a successful module swap. Atomic on a single
 * thread (Node/Bun is single-threaded for JS).
 */
export function bumpVersion(pluginId: string): number {
  const next = (versions.get(pluginId) ?? 0) + 1
  versions.set(pluginId, next)
  return next
}

/**
 * Reset the registry — only used by tests that want a clean slate. The
 * reload pipeline never calls this; bumpVersion is monotonic by design.
 */
export function __resetVersionsForTest(): void {
  versions.clear()
}

/** Header name shared with the client-side detector. */
export const PLUGIN_VERSION_HEADER = 'X-Bakin-Plugin-Version'

/**
 * Build the header value. Format: `<pluginId>:<version>`. The client
 * parses both parts so it can verify the response is for the plugin it
 * thinks it is — defense against weird intermediate caches.
 */
export function pluginVersionHeader(pluginId: string): string {
  return `${pluginId}:${getVersion(pluginId)}`
}

/**
 * Wrap a Response to add the X-Bakin-Plugin-Version header. Cheap —
 * Response is immutable, so we clone via the streaming constructor.
 * Called from `packages/host/src/api/_adapter.ts` for every response
 * dispatched out of `/api/plugins/<id>/*`.
 */
export function stampPluginResponse(pluginId: string, response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set(PLUGIN_VERSION_HEADER, pluginVersionHeader(pluginId))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
