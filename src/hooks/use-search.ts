'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface SearchResult {
  id: string
  table: string
  score: number
  fields: Record<string, unknown>
  _table?: string
  /** Per-index score breakdown (e.g. { search: 0.8, embeddings: 0.6 }) */
  indexScores?: Record<string, number>
}

export interface SearchResponse {
  results: SearchResult[]
  aggregations?: Record<string, Array<{ value: string; count: number }>>
  meta?: {
    query: string
    total: number
    took_ms: number
    source: 'search' | 'fallback'
  }
}

export interface UseSearchOptions {
  /**
   * Plugin id to route the query to. When set, the hook fetches
   * `/api/plugins/{plugin}/search?q=...` — the plugin owns its table
   * name and the client never sees the raw `bakin_` prefix. Omit for
   * cross-plugin search, which falls back to `/api/search?q=...`.
   */
  plugin?: string
  /** Max results */
  limit?: number
  /** Facet fields to include aggregation counts for */
  facets?: string[]
  /** Debounce delay in ms (default: 250) */
  debounce?: number
  /** Fallback filter function when search returns no results or errors */
  fallback?: (query: string) => SearchResult[]
}

export interface UseSearchReturn {
  results: SearchResult[]
  aggregations: Record<string, Array<{ value: string; count: number }>>
  loading: boolean
  error: string | null
  meta: SearchResponse['meta'] | null
  search: (query: string) => void
  clear: () => void
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
 * React hook for Bakin search with debouncing, AbortController, and an
 * optional client-side fallback. Scopes to a plugin via `plugin:` or
 * runs cross-plugin when omitted.
 */
export function useSearch(options: UseSearchOptions = {}): UseSearchReturn {
  const {
    plugin,
    limit = 20,
    facets,
    debounce: debounceMs = 250,
    fallback,
  } = options

  const [results, setResults] = useState<SearchResult[]>([])
  const [aggregations, setAggregations] = useState<Record<string, Array<{ value: string; count: number }>>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<SearchResponse['meta'] | null>(null)
  const [, setQuery] = useState('')

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

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
      setLoading(false)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ q })
      if (limit) params.set('limit', String(limit))
      if (facets?.length) params.set('facets', facets.join(','))

      // Plugin-scoped → /api/plugins/{plugin}/search (table name stays server-side).
      // No plugin → /api/search (cross-plugin).
      const url = plugin
        ? `/api/plugins/${plugin}/search?${params}`
        : `/api/search?${params}`

      const res = await fetch(url, { signal: controller.signal })

      if (!mountedRef.current) return

      if (!res.ok) {
        throw new Error(`Search failed: ${res.status}`)
      }

      const data: SearchResponse = await res.json()

      if (!mountedRef.current) return

      if (data.results.length === 0 && data.meta?.source === 'fallback' && fallback) {
        setResults(fallback(q))
        setAggregations({})
        setMeta(data.meta)
      } else {
        setResults(data.results)
        setAggregations(data.aggregations || {})
        setMeta(data.meta || null)
      }
    } catch (err) {
      if (!mountedRef.current) return
      if (err instanceof DOMException && err.name === 'AbortError') return

      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)

      if (fallback) {
        setResults(fallback(q))
        setAggregations({})
      } else {
        setResults([])
        setAggregations({})
      }
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [plugin, limit, facets, fallback])

  const search = useCallback((q: string) => {
    setQuery(q)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!q.trim()) {
      setResults([])
      setAggregations({})
      setMeta(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    timerRef.current = setTimeout(() => executeSearch(q), debounceMs)
  }, [executeSearch, debounceMs])

  const clear = useCallback(() => {
    setQuery('')
    setResults([])
    setAggregations({})
    setMeta(null)
    setError(null)
    setLoading(false)
    abortRef.current?.abort()
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return { results, aggregations, loading, error, meta, search, clear }
}
