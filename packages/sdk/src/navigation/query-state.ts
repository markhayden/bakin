'use client'

import { useCallback, useMemo, useRef } from 'react'
import { usePathname, useRouter, useSearchParams, type Router } from './router'

const pendingPatch = new Map<string, string | null>()
let pendingPush = false
let pendingNav: { router: Router; pathname: string } | null = null
let flushScheduled = false

function enqueueParamUpdate(
  key: string,
  value: string | null,
  push: boolean,
  router: Router,
  pathname: string,
): void {
  pendingPatch.set(key, value)
  pendingPush = pendingPush || push
  pendingNav = { router, pathname }
  if (flushScheduled) return
  flushScheduled = true
  queueMicrotask(() => {
    const navigation = pendingNav!
    const usePush = pendingPush
    const patch = new Map(pendingPatch)
    pendingPatch.clear()
    pendingPush = false
    pendingNav = null
    flushScheduled = false

    const params = new URLSearchParams(window.location.search)
    for (const [patchKey, patchValue] of patch) {
      if (patchValue === null) params.delete(patchKey)
      else params.set(patchKey, patchValue)
    }
    const query = params.toString()
    const url = query ? `${navigation.pathname}?${query}` : navigation.pathname
    if (usePush) navigation.router.push(url, { scroll: false })
    else navigation.router.replace(url, { scroll: false })
  })
}

/**
 * Bind one plain-string value to a query parameter. Routine setters replace
 * history; the third tuple item pushes. Same-tick setters batch into one URL.
 */
export function useQueryState(
  key: string,
  defaultValue = '',
): [string, (value: string) => void, (value: string) => void] {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname

  const value = searchParams.get(key) ?? defaultValue
  const setValue = useCallback((next: string) => {
    enqueueParamUpdate(key, next === defaultValue ? null : next, false, router, pathnameRef.current)
  }, [key, defaultValue, router])
  const pushValue = useCallback((next: string) => {
    enqueueParamUpdate(key, next === defaultValue ? null : next, true, router, pathnameRef.current)
  }, [key, defaultValue, router])

  return [value, setValue, pushValue]
}

/** Bind a comma-separated string collection to one query parameter. */
export function useQueryArrayState(key: string): [string[], (value: string[]) => void] {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname

  const value = useMemo(() => {
    const raw = searchParams.get(key)
    return raw ? raw.split(',').filter(Boolean) : []
  }, [searchParams, key])
  const setValue = useCallback((next: string[]) => {
    enqueueParamUpdate(key, next.length === 0 ? null : next.join(','), false, router, pathnameRef.current)
  }, [key, router])

  return [value, setValue]
}
