'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface PolledResult<T> {
  /** Parsed body, or null before the first successful load. */
  data: T | null
  /** Error message when this section's endpoint fails; null otherwise. */
  error: string | null
  /** True until the first settle (used to render a per-section skeleton). */
  loading: boolean
  /** Timestamp (ms) of the last successful load, or null. */
  lastUpdated: number | null
  /** Force an immediate refetch. */
  refresh: () => void
}

interface PolledOptions<T> {
  /** Poll cadence in ms. Omit for a one-shot load. */
  intervalMs?: number
  /** Bump to force every section to refetch (the header Refresh button). */
  refreshNonce?: number
  /**
   * Optional endpoints: on a non-2xx or transport error, keep the prior data and
   * report no error (the section simply renders nothing) instead of a fault card.
   */
  swallowErrors?: boolean
  /** Transform/validate the raw body; return null to reject and keep prior data. */
  select?: (raw: unknown) => T | null
}

/**
 * Per-section polled JSON GET with an independent { data, error, loading }
 * lifecycle. The health page's former all-or-nothing Promise.all gated every
 * panel behind one loading flag and blanked them all on a single fault; each
 * section now owns its own fetch so a failing endpoint only faults its own card.
 *
 * Deliberately NOT `useJsonFetch`: this hook adds polling cadence,
 * swallow-errors, select-validation, and keep-prior-data-on-fault semantics
 * that the SDK's one-shot hook intentionally doesn't carry.
 */
export function usePolledJson<T>(url: string | null, opts: PolledOptions<T> = {}): PolledResult<T> {
  const { intervalMs, refreshNonce = 0, swallowErrors = false, select } = opts
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(url !== null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick((n) => n + 1), [])

  // Read the transform without making it a dependency (callers pass literals).
  const selectRef = useRef(select)
  selectRef.current = select

  useEffect(() => {
    if (url === null) {
      setLoading(false)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) {
          if (cancelled) return
          if (swallowErrors) { setError(null) } else { setError(`Request failed (${res.status})`) }
          return
        }
        const json: unknown = await res.json()
        if (cancelled) return
        const parsed = selectRef.current ? selectRef.current(json) : (json as T)
        if (parsed !== null) setData(parsed)
        setError(null)
        setLastUpdated(Date.now())
      } catch (err) {
        if (cancelled) return
        if (swallowErrors) setError(null)
        else setError(err instanceof Error ? err.message : 'Request failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    if (intervalMs) {
      const id = setInterval(load, intervalMs)
      return () => { cancelled = true; clearInterval(id) }
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, intervalMs, refreshNonce, tick, swallowErrors])

  return { data, error, loading, lastUpdated, refresh }
}

/** The health dashboard's standard poll cadence — matches the pre-split 10s loop. */
export const HEALTH_POLL_MS = 10_000
