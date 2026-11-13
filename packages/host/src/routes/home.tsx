/**
 * `/home` is the old address of the Home page, which now lives at `/`.
 * Redirected in `beforeLoad` (query string kept) so links that were shared
 * or bookmarked still land, and the router never renders a frame here.
 */
import { createRoute, redirect } from '@tanstack/react-router'
import { Route as RootRoute } from './__root'

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/home',
  beforeLoad: ({ location }) => {
    throw redirect({ to: '/', search: location.search })
  },
})
