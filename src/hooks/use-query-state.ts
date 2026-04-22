'use client'

import { useSearchParams, useRouter, usePathname } from '@bakin/sdk/hooks'
import { useCallback, useMemo, useRef } from 'react'

/**
 * Syncs a single string value to a URL query parameter.
 * Returns [value, setValue, pushValue] like useState.
 * - setValue uses router.replace (no history entry) — good for filters, search, view toggles
 * - pushValue uses router.push (creates history entry) — good for opening drawers/modals
 * When value equals defaultValue, the param is removed from the URL.
 */
export function useQueryState(key: string, defaultValue: string = ''): [string, (v: string) => void, (v: string) => void] {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // Use refs so the callback never goes stale
  const paramsRef = useRef(searchParams)
  paramsRef.current = searchParams
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname

  const value = searchParams.get(key) ?? defaultValue

  const buildUrl = useCallback((v: string) => {
    const params = new URLSearchParams(paramsRef.current.toString())
    if (v === defaultValue) {
      params.delete(key)
    } else {
      params.set(key, v)
    }
    const qs = params.toString()
    return qs ? `${pathnameRef.current}?${qs}` : pathnameRef.current
  }, [key, defaultValue])

  const setValue = useCallback((v: string) => {
    router.replace(buildUrl(v), { scroll: false })
  }, [router, buildUrl])

  const pushValue = useCallback((v: string) => {
    router.push(buildUrl(v), { scroll: false })
  }, [router, buildUrl])

  return [value, setValue, pushValue]
}

/**
 * Syncs a string[] to a URL query parameter (comma-separated).
 * Returns [values, setValues] like useState.
 * When array is empty, the param is removed from the URL.
 */
export function useQueryArrayState(key: string): [string[], (v: string[]) => void] {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const paramsRef = useRef(searchParams)
  paramsRef.current = searchParams
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname

  const value = useMemo(() => {
    const raw = searchParams.get(key)
    if (!raw) return []
    return raw.split(',').filter(Boolean)
  }, [searchParams, key])

  const setValue = useCallback((v: string[]) => {
    const params = new URLSearchParams(paramsRef.current.toString())
    if (v.length === 0) {
      params.delete(key)
    } else {
      params.set(key, v.join(','))
    }
    const qs = params.toString()
    router.replace(qs ? `${pathnameRef.current}?${qs}` : pathnameRef.current, { scroll: false })
  }, [router, key])

  return [value, setValue]
}
