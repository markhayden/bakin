import { useEffect, useState } from 'react'

/**
 * Stub for Next.js `usePathname()` — returns the current window.location.pathname
 * and re-renders on popstate + synthetic pushState.
 *
 * TC25 of the Bun migration replaces this with TanStack Router's
 * `useLocation().pathname`. Until then, it gives shell components like
 * `AppSidebar` a reactive path without a router dependency.
 */
export function usePathname(): string {
  const [path, setPath] = useState(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/',
  )

  useEffect(() => {
    const update = () => setPath(window.location.pathname)
    window.addEventListener('popstate', update)

    // Patch history.pushState so framework/router navigations also fire a
    // synthetic event we can listen for. Restored on unmount.
    const origPush = window.history.pushState
    window.history.pushState = function (...args) {
      origPush.apply(this, args as Parameters<typeof origPush>)
      update()
    }

    return () => {
      window.removeEventListener('popstate', update)
      window.history.pushState = origPush
    }
  }, [])

  return path
}
