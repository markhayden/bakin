'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface AntflySearchResult {
  id: string
  table: string
  score: number
  fields: Record<string, unknown>
  _table?: string
  /** Per-index score breakdown (e.g. { search: 0.8, embeddings: 0.6 }) */
  indexScores?: Record<string, number>
}

export interface AntflySearchResponse {
  results: AntflySearchResult[]
  aggregations?: Record<string, Array<{ value: string; count: number }>>
  meta?: {
    query: string
    total: number
    took_ms: number
    source: 'antfly' | 'fallback'
  }
}

export interface UseAntflySearchOptions {
  /** Table to search (omit for cross-table) */
  table?: string
  /** Max results */
  limit?: number
  /** Facet fields to include aggregation counts for */
  facets?: string[]
  /** Debounce delay in ms (default: 250) */
  debounce?: number
  /** Fallback filter function when Antfly returns no results or errors */
  fallback?: (query: string) => AntflySearchResult[]
}

export interface UseAntflySearchReturn {
  results: AntflySearchResult[]
  aggregations: Record<string, Array<{ value: string; count: number }>>
  loading: boolean
  error: string | null
  meta: AntflySearchResponse['meta'] | null
  search: (query: string) => void
  clear: () => void
}

/**
 * Given a client-side filtered list and Antfly search results,
 * reorder the list so Antfly-matched items appear first (by score).
 * Items not in Antfly results keep their original order at the end.
 */
export function reorderByAntflyResults<T extends { id: string }>(
  items: T[],
  antflyResults: AntflySearchResult[],
): T[] {
  if (!antflyResults.length) return items

  const scoreMap = new Map<string, number>()
  for (const r of antflyResults) {
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

  // Sort matched items by Antfly score (descending)
  matched.sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0))

  return [...matched, ...unmatched]
}

/**
 * React hook for Antfly-powered search with debouncing, AbortController,
 * and optional client-side fallback.
 */
export function useAntflySearch(options: UseAntflySearchOptions = {}): UseAntflySearchReturn {
  const {
    table,
    limit = 20,
    facets,
    debounce: debounceMs = 250,
    fallback,
  } = options

  const [results, setResults] = useState<AntflySearchResult[]>([])
  const [aggregations, setAggregations] = useState<Record<string, Array<{ value: string; count: number }>>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<AntflySearchResponse['meta'] | null>(null)
  const [query, setQuery] = useState('')

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

    // Abort any in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ q })
      if (table) params.set('table', table)
      if (limit) params.set('limit', String(limit))
      if (facets?.length) params.set('facets', facets.join(','))

      const res = await fetch(`/api/search?${params}`, {
        signal: controller.signal,
      })

      if (!mountedRef.current) return

      if (!res.ok) {
        throw new Error(`Search failed: ${res.status}`)
      }

      const data: AntflySearchResponse = await res.json()

      if (!mountedRef.current) return

      // If Antfly returned empty results and we have a fallback, use it
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

      // Use fallback on error
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
  }, [table, limit, facets, fallback])

  // Debounced search trigger
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
