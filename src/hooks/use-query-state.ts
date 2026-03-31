'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useCallback, useMemo, useRef } from 'react'

/**
 * Syncs a single string value to a URL query parameter.
 * Returns [value, setValue] like useState.
 * When value equals defaultValue, the param is removed from the URL.
 */
export function useQueryState(key: string, defaultValue: string = ''): [string, (v: string) => void] {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // Use refs so the callback never goes stale
  const paramsRef = useRef(searchParams)
  paramsRef.current = searchParams
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname

  const value = searchParams.get(key) ?? defaultValue

  const setValue = useCallback((v: string) => {
    const params = new URLSearchParams(paramsRef.current.toString())
    if (v === defaultValue) {
      params.delete(key)
    } else {
      params.set(key, v)
    }
    const qs = params.toString()
    router.replace(qs ? `${pathnameRef.current}?${qs}` : pathnameRef.current, { scroll: false })
  }, [router, key, defaultValue])

  return [value, setValue]
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
