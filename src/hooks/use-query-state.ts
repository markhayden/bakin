'use client'

import { useSearchParams, useRouter, usePathname } from '@makinbakin/sdk/hooks'
import { useCallback, useMemo, useRef } from 'react'

/**
 * Microtask batcher (routing overhaul PR3, task 3.2): every setter enqueues
 * its param patch and ONE navigation fires per tick carrying all of them.
 * Historically each setter snapshotted pre-navigation params and navigated
 * immediately, so two setters in one handler clobbered each other — pages
 * hand-rolled "build one URL" workarounds and the knowledge doc banned the
 * pattern. The batch composes over window.location.search at flush time
 * (nothing enqueued this tick has navigated yet, so it's the stable base).
 * `push` wins over `replace` when any update in the tick pushed.
 */
type RouterLike = {
  push: (url: string, opts?: { scroll?: boolean }) => void
  replace: (url: string, opts?: { scroll?: boolean }) => void
}

const pendingPatch = new Map<string, string | null>() // null = remove
let pendingPush = false
let pendingNav: { router: RouterLike; pathname: string } | null = null
let flushScheduled = false

function enqueueParamUpdate(
  key: string,
  value: string | null,
  push: boolean,
  router: RouterLike,
  pathname: string,
): void {
  pendingPatch.set(key, value)
  pendingPush = pendingPush || push
  pendingNav = { router, pathname }
  if (flushScheduled) return
  flushScheduled = true
  queueMicrotask(() => {
    const nav = pendingNav!
    const usePush = pendingPush
    const patch = new Map(pendingPatch)
    pendingPatch.clear()
    pendingPush = false
    pendingNav = null
    flushScheduled = false

    const params = new URLSearchParams(window.location.search)
    for (const [k, v] of patch) {
      if (v === null) params.delete(k)
      else params.set(k, v)
    }
    const qs = params.toString()
    const url = qs ? `${nav.pathname}?${qs}` : nav.pathname
    if (usePush) nav.router.push(url, { scroll: false })
    else nav.router.replace(url, { scroll: false })
  })
}

/**
 * Syncs a single string value to a URL query parameter.
 * Returns [value, setValue, pushValue] like useState.
 * - setValue uses router.replace (no history entry) — good for filters, search, view toggles
 * - pushValue uses router.push (creates history entry) — good for opening drawers/modals
 * When value equals defaultValue, the param is removed from the URL.
 * Multiple setter calls in the same tick compose into one navigation.
 */
export function useQueryState(key: string, defaultValue: string = ''): [string, (v: string) => void, (v: string) => void] {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // Use refs so the callbacks never go stale
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname

  const value = searchParams.get(key) ?? defaultValue

  const setValue = useCallback((v: string) => {
    enqueueParamUpdate(key, v === defaultValue ? null : v, false, router, pathnameRef.current)
  }, [key, defaultValue, router])

  const pushValue = useCallback((v: string) => {
    enqueueParamUpdate(key, v === defaultValue ? null : v, true, router, pathnameRef.current)
  }, [key, defaultValue, router])

  return [value, setValue, pushValue]
}

/**
 * Syncs a string[] to a URL query parameter (comma-separated).
 * Returns [values, setValues] like useState.
 * When array is empty, the param is removed from the URL.
 * Composes with other setter calls in the same tick (one navigation).
 */
export function useQueryArrayState(key: string): [string[], (v: string[]) => void] {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname

  const value = useMemo(() => {
    const raw = searchParams.get(key)
    if (!raw) return []
    return raw.split(',').filter(Boolean)
  }, [searchParams, key])

  const setValue = useCallback((v: string[]) => {
    enqueueParamUpdate(key, v.length === 0 ? null : v.join(','), false, router, pathnameRef.current)
  }, [key, router])

  return [value, setValue]
}
