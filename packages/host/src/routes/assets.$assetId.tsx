/**
 * /assets/$assetId — versioned-asset detail route. The assets plugin owns the
 * page chrome via the `page:/assets/:assetId` slot; the wrapper is just
 * <Suspense>. The slot component reads $assetId from the route params.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function AssetDetailPage() {
  return (
    <Suspense>
      <Slot name="page:/assets/:assetId" />
    </Suspense>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/assets/$assetId',
  component: AssetDetailPage,
})
