/**
 * /explore — discovery storefront route.
 *
 * Thin Suspense wrapper around the explore plugin's slot.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function ExplorePage() {
  return (
    <Suspense>
      <Slot name="page:/explore" />
    </Suspense>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/explore',
  component: ExplorePage,
})
