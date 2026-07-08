/**
 * /brands — brand definitions route.
 *
 * Thin Suspense wrapper around the brands plugin's slot.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function BrandsPage() {
  return (
    <Suspense>
      <Slot name="page:/brands" />
    </Suspense>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/brands',
  component: BrandsPage,
})
