/**
 * Home route ('/').
 *
 * TC4 in the #147 plan gives this its real content (porting src/app/page.tsx).
 * For TC3 it's a placeholder so the router has at least one leaf.
 */
import { createRoute } from '@tanstack/react-router'
import { Route as RootRoute } from './__root'

function HomePlaceholder() {
  return (
    <div className="p-6 space-y-2">
      <h1 className="text-2xl font-semibold">Bakin</h1>
      <p className="text-sm text-muted-foreground">
        TanStack Router is live. TC4+ ports the 21 page routes into this tree.
      </p>
    </div>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/',
  component: HomePlaceholder,
})
