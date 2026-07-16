/**
 * Router hooks — TanStack Router wrappers exposed through `@makinbakin/sdk/hooks`.
 *
 * `useRouter()` returns `{ push, replace, refresh, back, forward }`,
 * `useSearchParams()` returns a `URLSearchParams`, and `usePathname()`
 * returns a string. These are the only router hooks plugins should use.
 */
import {
  useNavigate,
  useLocation,
  useParams as useTanstackParams,
} from '@tanstack/react-router'
import { useMemo } from 'react'

/**
 * `{ scroll?: boolean }` maps to TanStack's `resetScroll` (PR3 3.3):
 * `push` scrolls to top unless `scroll: false`; `replace` is a state tweak
 * (filters, drawers) and always keeps the scroll position.
 */
interface Router {
  push: (url: string, opts?: { scroll?: boolean }) => void
  replace: (url: string, _opts?: { scroll?: boolean }) => void
  back: () => void
  forward: () => void
  refresh: () => void
  /** No-op — TanStack prefetches on intent via `defaultPreload`. */
  prefetch: (_url: string) => void
}

interface StringNavigationOptions {
  to: string
  search: Record<string, string>
  hash: string
}

/**
 * Split a browser-style app URL into TanStack's pathname/search/hash fields.
 * Passing the whole string as `to` makes typed dynamic routes discard their
 * query string, so the shared string router must preserve those fields
 * explicitly.
 *
 * Values pass through as RAW STRINGS — the host router uses plain-string
 * serializers (packages/host/src/lib/search-params.ts), so nothing here
 * needs to counteract JSON quoting, and "123"-shaped ids never coerce.
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
 * `useRouter()` over TanStack Router. Accepts plain URL strings and
 * bypasses TanStack's typed-path safety on purpose — plugin authors
 * pass paths as strings through slots.
 */
export function useRouter(): Router {
  const navigate = useNavigate()
  return useMemo<Router>(() => ({
    push: (url, opts) => {
      navigate({
        ...toNavigationOptions(url),
        ...(opts?.scroll === false ? { resetScroll: false } : {}),
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
  const location = useLocation()
  return location.pathname
}

/**
 * Parsed query-string as a plain `URLSearchParams` — use `.get()`,
 * `.has()`, `.getAll()`, iteration, etc.
 */
export function useSearchParams(): URLSearchParams {
  const location = useLocation()
  return useMemo(() => {
    const search = (location as { searchStr?: string }).searchStr
    if (typeof search === 'string') {
      return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    }
    // Fallback: build from the `search` object (TanStack's parsed form).
    const parsed = (location as { search?: Record<string, unknown> }).search
    if (parsed && typeof parsed === 'object') {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(parsed)) {
        if (v === undefined || v === null) continue
        params.set(k, String(v))
      }
      return params
    }
    return new URLSearchParams()
  }, [location])
}

/**
 * Route params for the current leaf. Uses TanStack's `strict: false` mode
 * so components rendered inside a slot (not directly via the route tree)
 * still get usable params from the currently-matched route.
 */
export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useTanstackParams({ strict: false } as any) as T
}
