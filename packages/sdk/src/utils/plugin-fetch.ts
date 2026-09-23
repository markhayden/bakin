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

export interface PluginFetchJsonOptions {
  /** Hard deadline for the WHOLE call, body parsing included. */
  timeoutMs: number
  /** Names the request in the failure message (`"<label> fetch failed (503)"`). */
  label?: string
  /** The caller's own cancellation (unmount / dependency change). */
  signal?: AbortSignal
  init?: Parameters<typeof pluginFetch>[2]
}

/**
 * `pluginFetch` + JSON parse under a hard deadline, for call sites that are
 * plain functions (effects AND mutation handlers) rather than hooks — the
 * plain-function twin of `usePluginJsonFetch`'s `timeoutMs`.
 *
 * The deadline races the whole chain: `fetch` resolves at HEADERS, so racing
 * the bare fetch promise would still leave the caller hanging inside
 * `res.json()`. The caller's `signal` rejects as an `AbortError` (drop it
 * without touching state); a deadline breach rejects with a plain
 * `Error('Request timed out')` — never disguised as a caller cancellation.
 */
export async function pluginFetchJson<T>(
  pluginId: string,
  path: string,
  { timeoutMs, label = path, signal, init }: PluginFetchJsonOptions,
): Promise<T> {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', forwardAbort, { once: true })

  let timedOut = false
  let rejectDeadline: ((reason: Error) => void) | null = null
  const deadline = setTimeout(() => {
    timedOut = true
    // Abort to free the socket, but RACE the rejection rather than relying on
    // it: a fetch implementation that ignores the signal would otherwise leave
    // the caller hanging forever, the exact failure the deadline prevents.
    controller.abort()
    rejectDeadline?.(new Error('Request timed out'))
  }, timeoutMs)

  const request = pluginFetch(pluginId, path, { ...init, signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`${label} fetch failed (${res.status})`)
      return await res.json() as T
    })

  try {
    return await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => { rejectDeadline = reject }),
    ])
  } catch (err) {
    if (timedOut) throw new Error('Request timed out')
    throw err
  } finally {
    clearTimeout(deadline)
    rejectDeadline = null
    signal?.removeEventListener('abort', forwardAbort)
  }
}
