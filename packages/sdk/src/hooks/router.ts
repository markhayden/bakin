/**
 * Router hooks — TanStack Router wrappers exposed through `@bakin/sdk/hooks`.
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
 * `NavigateOptions` accepts `{ scroll?: boolean }` for call-site
 * readability; TanStack preserves scroll by default, so the flag is
 * accepted-and-ignored.
 */
interface Router {
  push: (url: string, _opts?: { scroll?: boolean }) => void
  replace: (url: string, _opts?: { scroll?: boolean }) => void
  back: () => void
  forward: () => void
  refresh: () => void
  /** No-op — TanStack prefetches on intent via `defaultPreload`. */
  prefetch: (_url: string) => void
}

/**
 * `useRouter()` over TanStack Router. Accepts plain URL strings and
 * bypasses TanStack's typed-path safety on purpose — plugin authors
 * pass paths as strings through slots.
 */
export function useRouter(): Router {
  const navigate = useNavigate()
  return useMemo<Router>(() => ({
    push: (url) => {
      navigate({ to: url as any })
    },
    replace: (url) => {
      navigate({ to: url as any, replace: true })
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
