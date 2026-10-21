/**
 * Conditional JSON fetches for update sources (#1007, D7.3/D7.6): ETag /
 * Last-Modified validators persisted per normalized endpoint in the engine's
 * conditional store, so a 304 — even after a restart — reuses the stored
 * body; 403/429 answers become an `UpdateCheckError` carrying the server's
 * own retry hint (`Retry-After`, `X-RateLimit-Reset`) for the scheduler.
 */
import { UpdateCheckError, type ConditionalStore } from './types'

export type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>

export interface ConditionalFetchOptions {
  conditional: ConditionalStore
  /** Normalized key (endpoint + repo + ref) — NEVER a source kind (C12). Defaults to the URL. */
  key?: string
  headers?: Record<string, string>
  signal?: AbortSignal
  fetch?: FetchLike
}

export interface ConditionalFetchResult<T> {
  body: T
  /** True when the server answered 304 and the stored representation was reused. */
  notModified: boolean
  status: number
}

export class HttpStatusError extends UpdateCheckError {
  constructor(readonly status: number, readonly url: string, retryAfterMs?: number) {
    super(`HTTP ${status} from ${url}`, retryAfterMs)
    this.name = 'HttpStatusError'
  }
}

/** The retry hint a rate-limiting answer carries, in ms from now; undefined when it carries none. */
export function retryHintMs(headers: Headers, now = Date.now()): number | undefined {
  const retryAfter = headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000))
    const at = Date.parse(retryAfter)
    if (Number.isFinite(at)) return Math.max(0, at - now)
  }
  const reset = headers.get('x-ratelimit-reset')
  const remaining = headers.get('x-ratelimit-remaining')
  if (reset && (remaining === null || Number(remaining) <= 0)) {
    const at = Number(reset) * 1000
    if (Number.isFinite(at)) return Math.max(0, at - now)
  }
  return undefined
}

export async function conditionalFetchJson<T>(url: string, opts: ConditionalFetchOptions): Promise<ConditionalFetchResult<T>> {
  const key = opts.key ?? url
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init))
  const stored = opts.conditional.get(key)
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (stored?.etag) headers['If-None-Match'] = stored.etag
  if (stored?.lastModified) headers['If-Modified-Since'] = stored.lastModified
  const res = await doFetch(url, { headers, signal: opts.signal })
  if (res.status === 304) {
    if (stored?.body === undefined) throw new UpdateCheckError(`HTTP 304 from ${url} but no stored representation to reuse`)
    return { body: stored.body as T, notModified: true, status: 304 }
  }
  if (res.status === 403 || res.status === 429) {
    throw new HttpStatusError(res.status, url, retryHintMs(res.headers))
  }
  if (!res.ok) throw new HttpStatusError(res.status, url)
  const body = (await res.json()) as T
  const etag = res.headers.get('etag') ?? undefined
  const lastModified = res.headers.get('last-modified') ?? undefined
  if (etag || lastModified) opts.conditional.set(key, { etag, lastModified, body })
  return { body, notModified: false, status: res.status }
}
