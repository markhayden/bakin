/**
 * Router instance for the Bakin host.
 *
 * Route tree is assembled here; each route module exports its `Route`
 * definition and we wire them via `addChildren`. TC4-TC24 (per the #147
 * plan) add more leaves under the root.
 */
import { createRouter } from '@tanstack/react-router'
import { Route as RootRoute } from './routes/__root'
import { Route as IndexRoute } from './routes/index'
import { Route as TasksRoute } from './routes/tasks'

const routeTree = RootRoute.addChildren([
  IndexRoute,
  TasksRoute,
])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

// Register the router instance for type safety across the app.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
