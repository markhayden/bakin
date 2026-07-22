'use client'

import {
  useLocation,
  useNavigate,
  useParams as useTanstackParams,
} from '@tanstack/react-router'
import { useMemo } from 'react'

/** Options shared by imperative string navigation. */
export interface RouterNavigationOptions {
  scroll?: boolean
}

/** Browser router facade for runtime-registered plugin paths. */
export interface Router {
  push: (url: string, options?: RouterNavigationOptions) => void
  replace: (url: string, options?: RouterNavigationOptions) => void
  back: () => void
  forward: () => void
  refresh: () => void
  /** No-op — TanStack prefetches on intent via `defaultPreload`. */
  prefetch: (url: string) => void
}

export interface StringNavigationOptions {
  to: string
  search: Record<string, string>
  hash: string
}

/**
 * Split a browser-style app URL into TanStack's pathname/search/hash fields.
 * Values remain raw strings under the host's plain-string search contract.
 */
export function toNavigationOptions(url: string): StringNavigationOptions {
  const hashIndex = url.indexOf('#')
  const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url
  const hash = hashIndex >= 0 ? url.slice(hashIndex + 1) : ''
  const queryIndex = beforeHash.indexOf('?')
  const to = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : ''
  const search: Record<string, string> = Object.create(null)
  for (const [key, raw] of new URLSearchParams(query)) search[key] = raw

  return { to, search, hash }
}

/**
 * Imperative client navigation for string paths contributed at runtime.
 * `push` resets scroll unless disabled; `replace` always preserves scroll.
 */
export function useRouter(): Router {
  const navigate = useNavigate()
  return useMemo<Router>(() => ({
    push: (url, options) => {
      navigate({
        ...toNavigationOptions(url),
        ...(options?.scroll === false ? { resetScroll: false } : {}),
      } as any)
    },
    replace: (url) => {
      navigate({ ...toNavigationOptions(url), replace: true, resetScroll: false } as any)
    },
    back: () => {
      if (typeof window !== 'undefined') window.history.back()
    },
    forward: () => {
      if (typeof window !== 'undefined') window.history.forward()
    },
    refresh: () => {
      if (typeof window !== 'undefined') window.location.reload()
    },
    prefetch: () => {
      /* no-op — TanStack prefetches on intent via defaultPreload */
    },
  }), [navigate])
}

/** Current pathname (`/tasks`, `/team/abc-123`, ...). */
export function usePathname(): string {
  return useLocation().pathname
}

/** Current query string as a standard `URLSearchParams`. */
export function useSearchParams(): URLSearchParams {
  const location = useLocation()
  return useMemo(() => {
    const search = (location as { searchStr?: string }).searchStr
    if (typeof search === 'string') {
      return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    }
    const parsed = (location as { search?: Record<string, unknown> }).search
    if (parsed && typeof parsed === 'object') {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(parsed)) {
        if (value === undefined || value === null) continue
        params.set(key, String(value))
      }
      return params
    }
    return new URLSearchParams()
  }, [location])
}

/** Current leaf parameters, including components mounted through slots. */
export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useTanstackParams({ strict: false } as any) as T
}
