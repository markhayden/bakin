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

/**
 * Cancellable JSON GET with the standard `{ data, loading, error, refresh }` lifecycle —
 * the consolidation of the `let cancelled = false` fetch-in-useEffect boilerplate scattered
 * across plugin components. Aborts the in-flight request on unmount or when `url` changes,
 * so it never sets state after unmount.
 *
 * Pass `url = null` to skip fetching (e.g. until an id is known); `data` resets to null and
 * `loading` is false while skipped. `opts` is read per-request but does NOT re-trigger on its
 * own identity — change `url` or call `refresh()` to re-fetch.
 */
export function useJsonFetch<T>(url: string | null, opts?: RequestInit): UseJsonFetchResult<T> {
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
    setLoading(true)
    setError(null)
    fetch(url, { ...optsRef.current, signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        return (await res.json()) as T
      })
      .then((json) => {
        if (controller.signal.aborted) return
        setData(json)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err as { name?: string })?.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Request failed')
        setLoading(false)
      })
    return () => controller.abort()
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
  opts?: RequestInit,
): UseJsonFetchResult<T> {
  const clean = path === null ? null : path.startsWith('/') ? path.slice(1) : path
  return useJsonFetch<T>(clean === null ? null : `/api/plugins/${pluginId}/${clean}`, opts)
}
