/**
 * Test-environment shim for `@tanstack/react-router`.
 *
 * Vitest runs plugin + shell components in a bare jsdom environment without
 * a `<RouterProvider>` context. The real TanStack Router hooks throw when
 * called outside that context (`useLocation`'s `isServer` check reads from
 * a null-in-tests state). This shim returns inert values for the hooks
 * used by `@makinbakin/sdk/hooks/router.ts`, plus no-op stubs for the few
 * components (`<Outlet />`, `<Link />`, `<RouterProvider />`) we touch.
 *
 * Wire via alias in `vitest.config.ts`:
 *   '@tanstack/react-router': tests/shims/tanstack-router.ts
 *
 * Production code is unaffected — Bun.build()'s bundle resolves the real
 * module because this shim only loads when the Vitest config's alias map
 * kicks in.
 */
import type { ComponentType, ReactNode } from 'react'

export function useNavigate(): (...args: unknown[]) => void {
  return () => {}
}

export function useLocation(): { pathname: string; searchStr: string; search: Record<string, unknown>; hash: string } {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'
  const searchStr = typeof window !== 'undefined' ? window.location.search : ''
  return { pathname, searchStr, search: {}, hash: '' }
}

export function useParams<T = Record<string, string>>(_opts?: unknown): T {
  return {} as T
}

export function useSearch<T = Record<string, unknown>>(_opts?: unknown): T {
  return {} as T
}

export function useRouter(): { navigate: (opts: unknown) => void } {
  return { navigate: () => {} }
}

// Route-builder stubs (only referenced by route modules, not by tests directly).
export function createRootRoute<T>(opts: T): T {
  return opts
}
export function createRoute<T>(opts: T): T {
  return opts
}
export function createRouter<T>(opts: T): T {
  return opts
}
export function createMemoryHistory<T>(opts: T): T {
  return opts
}
export function redirect(opts: unknown): never {
  throw new Error('redirect() called outside RouterProvider — test-shim stub')
}

export const RouterProvider: ComponentType<{ router: unknown; children?: ReactNode }> = ({ children }) => {
  return (children as any) ?? null
}

export const Outlet: ComponentType = () => null

export const Link: ComponentType<{ to?: string; children?: ReactNode; className?: string; onClick?: (e: unknown) => void }> = ({
  to,
  children,
  className,
  onClick,
}) => {
  return { type: 'a', props: { href: to, className, onClick, children }, key: null, ref: null } as any
}
