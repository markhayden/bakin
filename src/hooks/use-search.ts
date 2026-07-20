'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface SearchResult {
  id: string
  table: string
  score: number
  fields: Record<string, unknown>
  _table?: string
  /** Per-leg score breakdown keyed by neutral leg names (e.g. { full_text: 0.8, assets_visual: -0.2 }) */
  indexScores?: Record<string, number>
}

export interface SearchResponse {
  results: SearchResult[]
  aggregations?: Record<string, Array<{ value: string; count: number }>>
  meta?: {
    query: string
    total: number
    took_ms: number
    source: 'search' | 'unavailable'
    /** True when any source degraded/was omitted under the query budget. */
    partial?: boolean
    tables?: Array<{ table: string; hits: number; took_ms: number; budget?: 'degraded' | 'omitted' }>
  }
}

/**
 * Honest search lifecycle (spec D11). `unavailable` is the explicit
 * engine-down signal (HTTP 503 `search_unavailable`) — render
 * `<SearchUnavailable/>`, never a silent lower-quality substitute.
 */
export type SearchStatus = 'idle' | 'loading' | 'ok' | 'unavailable' | 'error'

export interface UseSearchOptions {
  /**
   * Plugin id to route the query to. When set, the hook fetches
   * `/api/plugins/{plugin}/search?q=...` — the plugin owns its table
   * name and the client never sees the raw `bakin_` prefix. Omit for
   * cross-plugin search via `/api/search?q=...`.
   */
  plugin?: string
  /** Max results */
  limit?: number
  /** Facet fields to include aggregation counts for */
  facets?: string[]
  /** Restrict cross-plugin search to these content types (tables). */
  types?: string[]
  /** Debounce delay in ms (default: 250) */
  debounce?: number
}

export interface UseSearchReturn {
  results: SearchResult[]
  aggregations: Record<string, Array<{ value: string; count: number }>>
  status: SearchStatus
  /** True while a request is in flight or debounce-pending (=== status 'loading'). */
  loading: boolean
  error: string | null
  meta: SearchResponse['meta'] | null
  search: (query: string) => void
  clear: () => void
  /** Re-run the last query immediately (Retry in the unavailable state). */
  retry: () => void
}

/**
 * Given a client-side filtered list and search results, reorder the list
 * so matched items appear first (by score). Items not in results keep
 * their original order at the end.
 */
export function reorderBySearchResults<T extends { id: string }>(
  items: T[],
  searchResults: SearchResult[],
): T[] {
  if (!searchResults.length) return items

  const scoreMap = new Map<string, number>()
  for (const r of searchResults) {
    scoreMap.set(r.id, r.score)
  }

  const matched: T[] = []
  const unmatched: T[] = []

  for (const item of items) {
    if (scoreMap.has(item.id)) {
      matched.push(item)
    } else {
      unmatched.push(item)
    }
  }

  matched.sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0))

  return [...matched, ...unmatched]
}

/**
 * React hook for Bakin search with debouncing and AbortController.
 * Scopes to a plugin via `plugin:` or runs cross-plugin when omitted.
 * There is deliberately NO client-side fallback: engine-down is an
 * explicit `unavailable` status the UI must surface (spec D11).
 */
export function useSearch(options: UseSearchOptions = {}): UseSearchReturn {
  const {
    plugin,
    limit = 20,
    facets,
    types,
    debounce: debounceMs = 250,
  } = options

  const [results, setResults] = useState<SearchResult[]>([])
  const [aggregations, setAggregations] = useState<Record<string, Array<{ value: string; count: number }>>>({})
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<SearchResponse['meta'] | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const lastQueryRef = useRef('')
  const typesKey = types?.join(',')

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const executeSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setAggregations({})
      setMeta(null)
      setError(null)
      setStatus('idle')
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus('loading')
    setError(null)

    try {
      const params = new URLSearchParams({ q })
      if (limit) params.set('limit', String(limit))
      if (facets?.length) params.set('facets', facets.join(','))
      if (typesKey) params.set('types', typesKey)

      // Plugin-scoped → /api/plugins/{plugin}/search (table name stays server-side).
      // No plugin → /api/search (cross-plugin).
      const url = plugin
        ? `/api/plugins/${plugin}/search?${params}`
        : `/api/search?${params}`

      const res = await fetch(url, { signal: controller.signal })

      if (!mountedRef.current) return

      if (res.status === 503) {
        // The explicit engine-down contract: 503 { error: 'search_unavailable' }.
        setResults([])
        setAggregations({})
        setMeta(null)
        setStatus('unavailable')
        return
      }

      if (!res.ok) {
        throw new Error(`Search failed: ${res.status}`)
      }

      const data: SearchResponse = await res.json()

      if (!mountedRef.current) return

      // A 200 with a malformed body must not poison every consumer with
      // `results: undefined` — .length crashes take down whole boards.
      setResults(Array.isArray(data.results) ? data.results : [])
      setAggregations(data.aggregations || {})
      setMeta(data.meta || null)
      setStatus('ok')
    } catch (err) {
      if (!mountedRef.current) return
      if (err instanceof DOMException && err.name === 'AbortError') return

      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setResults([])
      setAggregations({})
      setStatus('error')
    }
  }, [plugin, limit, facets, typesKey])

  const search = useCallback((q: string) => {
    lastQueryRef.current = q
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!q.trim()) {
      setResults([])
      setAggregations({})
      setMeta(null)
      setError(null)
      setStatus('idle')
      return
    }
    setStatus('loading')
    timerRef.current = setTimeout(() => executeSearch(q), debounceMs)
  }, [executeSearch, debounceMs])

  const retry = useCallback(() => {
    if (lastQueryRef.current.trim()) void executeSearch(lastQueryRef.current)
  }, [executeSearch])

  const clear = useCallback(() => {
    lastQueryRef.current = ''
    setResults([])
    setAggregations({})
    setMeta(null)
    setError(null)
    setStatus('idle')
    abortRef.current?.abort()
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return {
    results,
    aggregations,
    status,
    loading: status === 'loading',
    error,
    meta,
    search,
    clear,
    retry,
  }
}
