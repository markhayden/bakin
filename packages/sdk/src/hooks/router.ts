/**
 * Router hooks — TanStack Router wrappers exposed through `@bakin/sdk/hooks`.
 *
 * Shape-compatible with the Next.js `next/navigation` API we migrated off
 * of: `useRouter()` returns `{ push, replace, refresh, back, forward }`,
 * `useSearchParams()` returns a `URLSearchParams`, `usePathname()` returns
 * a string.
 *
 * Added in TC25 of the Bun migration (#147). Plugin components must import
 * these from `@bakin/sdk/hooks` — never `next/navigation`, which exits the
 * repo entirely in Phase I.
 */
import {
  useNavigate,
  useLocation,
  useParams as useTanstackParams,
} from '@tanstack/react-router'
import { useMemo } from 'react'

/**
 * Second argument mirrors Next.js's `NavigateOptions` ({ scroll?: boolean }).
 * TanStack preserves scroll by default on navigate, so the flag is
 * accepted-and-ignored — we keep the shape for drop-in source compat with
 * existing `router.push(url, { scroll: false })` call sites.
 */
interface NextLikeRouter {
  push: (url: string, _opts?: { scroll?: boolean }) => void
  replace: (url: string, _opts?: { scroll?: boolean }) => void
  back: () => void
  forward: () => void
  refresh: () => void
  /** Next.js no-op compat. TanStack prefetches on intent automatically. */
  prefetch: (_url: string) => void
}

/**
 * Next.js-shaped `useRouter()` over TanStack Router. Accepts absolute URL
 * strings; bypasses TanStack's typed-path safety on purpose because plugin
 * authors pass paths as plain strings through slots.
 */
export function useRouter(): NextLikeRouter {
  const navigate = useNavigate()
  return useMemo<NextLikeRouter>(() => ({
    push: (url) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigate({ to: url as any })
    },
    replace: (url) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 * Parsed query-string as a `URLSearchParams`. Next.js returned a
 * `ReadonlyURLSearchParams`; we return plain `URLSearchParams` which is
 * API-compatible for `.get()`, `.has()`, `.getAll()`, iteration, etc.
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useTanstackParams({ strict: false } as any) as T
}
