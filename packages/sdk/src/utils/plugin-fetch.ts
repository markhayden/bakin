/**
 * `pluginFetch` — call your own plugin's API routes without hand-building
 * `/api/plugins/<id>/...` URL strings (the most common client-side typo).
 *
 * Composes with the host's dev-mode fetch instrumentation automatically:
 * it calls the global `fetch`, which the host wraps to watch the
 * `X-Bakin-Plugin-Version` header for hot-reload drift — no duplicate
 * plumbing here.
 */

/** Build the canonical URL for a plugin API route: `/api/plugins/<id>/<path>`. */
export function pluginApiUrl(pluginId: string, path: string): string {
  const clean = path.startsWith('/') ? path.slice(1) : path
  return `/api/plugins/${pluginId}/${clean}`
}

/**
 * Fetch a plugin API route. JSON is the default dialect: `Accept` is set,
 * and a plain-object `body` is stringified with `Content-Type: application/json`
 * (pass a `BodyInit` — string/FormData/Blob — to opt out).
 *
 * Returns the raw `Response`; pair with `usePluginJsonFetch` (from
 * `@makinbakin/sdk/hooks`) for the `{ data, loading, error, refresh }`
 * lifecycle in components.
 */
export function pluginFetch(
  pluginId: string,
  path: string,
  init?: Omit<RequestInit, 'body'> & { body?: RequestInit['body'] | Record<string, unknown> },
): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')

  let body = init?.body as RequestInit['body'] | undefined
  const isPlainObject =
    init?.body !== undefined &&
    init.body !== null &&
    typeof init.body === 'object' &&
    !(init.body instanceof FormData) &&
    !(init.body instanceof Blob) &&
    !(init.body instanceof ArrayBuffer) &&
    !(init.body instanceof URLSearchParams) &&
    !(typeof ReadableStream !== 'undefined' && init.body instanceof ReadableStream)
  if (isPlainObject) {
    body = JSON.stringify(init.body)
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  }

  return fetch(pluginApiUrl(pluginId, path), { ...init, headers, body })
}
