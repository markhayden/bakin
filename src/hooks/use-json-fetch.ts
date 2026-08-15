'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseJsonFetchResult<T> {
  /** Parsed JSON body, or null before the first successful load. */
  data: T | null
  /** True while a request is in flight. */
  loading: boolean
  /** Error message on a non-2xx response or a network/parse failure; null otherwise. */
  error: string | null
  /** Re-run the fetch (e.g. after a mutation). */
  refresh: () => void
}

export interface UseJsonFetchOptions extends RequestInit {
  /**
   * Abort the request after this many milliseconds and report it as a timeout
   * rather than a silent hang. Endpoints that scan the filesystem or call the
   * runtime can stall indefinitely; without a deadline the caller shows a
   * spinner forever.
   */
  timeoutMs?: number
}

/**
 * Cancellable JSON GET with the standard `{ data, loading, error, refresh }` lifecycle —
 * the consolidation of the `let cancelled = false` fetch-in-useEffect boilerplate scattered
 * across plugin components. Aborts the in-flight request on unmount or when `url` changes,
 * so it never sets state after unmount.
 *
 * Pass `url = null` to skip fetching (e.g. until an id is known); `data` resets to null and
 * `loading` is false while skipped. `opts` is read per-request but does NOT re-trigger on its
 * own identity — change `url` or call `refresh()` to re-fetch. Set `opts.timeoutMs` to bound
 * a request that can hang.
 */
export function useJsonFetch<T>(url: string | null, opts?: UseJsonFetchOptions): UseJsonFetchResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState<boolean>(url !== null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  // Read opts fresh each request without making it a dependency (callers pass literals).
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    if (url === null) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }
    const controller = new AbortController()
    const { timeoutMs, ...init } = optsRef.current ?? {}
    // A deadline abort must survive the AbortError guard below, otherwise the
    // timeout would look identical to an unmount and never surface.
    let timedOut = false
    let rejectDeadline: ((reason: Error) => void) | null = null
    const deadline = timeoutMs !== undefined && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          // Abort to free the socket, but RACE the rejection rather than
          // relying on it: a fetch implementation that ignores the signal
          // would otherwise leave the caller hanging forever, which is the
          // exact failure the deadline exists to prevent.
          controller.abort()
          rejectDeadline?.(new Error('Request timed out'))
        }, timeoutMs)
      : null
    const clearDeadline = () => {
      if (deadline !== null) clearTimeout(deadline)
      rejectDeadline = null
    }
    // `aborted` cannot stand in for "this effect is stale" once a deadline can
    // abort a still-current effect: `fetch` resolves at HEADERS, so a slow body
    // could settle after the deadline fired, leaving the success path to see an
    // aborted signal and return without ever clearing `loading`. Track staleness
    // separately from abort.
    let cancelled = false
    setLoading(true)
    setError(null)
    // The deadline must race the WHOLE chain, body parsing included. Racing the
    // bare `fetch` promise only covers headers, so a response whose headers beat
    // the deadline settled the race and left the rejection with nothing to
    // reject — the request then hung in `res.json()` forever.
    const request = fetch(url, { ...init, signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        return (await res.json()) as T
      })
    const raced = deadline === null
      ? request
      : Promise.race([
          request,
          new Promise<never>((_resolve, reject) => { rejectDeadline = reject }),
        ])
    raced
      .then((json) => {
        clearDeadline()
        if (cancelled) return
        if (timedOut) {
          setError('Request timed out')
          setLoading(false)
          return
        }
        setData(json)
        setLoading(false)
      })
      .catch((err: unknown) => {
        clearDeadline()
        if (cancelled) return
        if (timedOut) {
          setError('Request timed out')
          setLoading(false)
          return
        }
        if ((err as { name?: string })?.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Request failed')
        setLoading(false)
      })
    return () => {
      cancelled = true
      clearDeadline()
      controller.abort()
    }
  }, [url, nonce])

  return { data, loading, error, refresh }
}

/**
 * `useJsonFetch` scoped to a plugin's own API: builds `/api/plugins/<id>/<path>`
 * so components never hand-assemble the prefix. Pass `path = null` to skip.
 */
export function usePluginJsonFetch<T>(
  pluginId: string,
  path: string | null,
  opts?: UseJsonFetchOptions,
): UseJsonFetchResult<T> {
  const clean = path === null ? null : path.startsWith('/') ? path.slice(1) : path
  return useJsonFetch<T>(clean === null ? null : `/api/plugins/${pluginId}/${clean}`, opts)
}
