/**
 * /assets — asset browser route.
 *
 * Mirrors `src/app/assets/page.tsx`: the assets plugin owns its own
 * page chrome, so the route wrapper is just <Suspense>.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function AssetsPage() {
  return (
    <Suspense>
      <Slot name="page:/assets" />
    </Suspense>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/assets',
  component: AssetsPage,
})
