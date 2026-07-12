/**
 * /brands/$brandId — brand detail route. The brands plugin owns the page
 * chrome via the `page:/brands/:brandId` slot; the wrapper is just
 * <Suspense>. The slot component reads $brandId from the route params.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function BrandDetailPage() {
  return (
    <Suspense>
      <Slot name="page:/brands/:brandId" />
    </Suspense>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/brands/$brandId',
  component: BrandDetailPage,
})
