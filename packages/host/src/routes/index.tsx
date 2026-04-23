/**
 * Home route ('/').
 *
 * Mirrors `src/app/page.tsx` — immediately redirects to `/tasks` so the
 * dashboard's default landing is the task board. Implemented as a
 * `beforeLoad` redirect so the router never renders a flash frame here.
 *
 * Left for last in the TC4-TC24 port because every other route had to
 * be registered first — TanStack's typed `redirect({ to: ... })` rejects
 * destinations that aren't in the route tree.
 */
import { createRoute, redirect } from '@tanstack/react-router'
import { Route as RootRoute } from './__root'

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/tasks' })
  },
})
