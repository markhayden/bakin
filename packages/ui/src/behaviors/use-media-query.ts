import { useSyncExternalStore } from 'react'

/**
 * Whether a CSS media query currently matches, read from the browser as an
 * external store (`matchMedia` + its change event). False wherever
 * `matchMedia` is unavailable. The render-safe way to depend on a
 * breakpoint instead of probing it inside an effect (issue 966b).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  )
}
