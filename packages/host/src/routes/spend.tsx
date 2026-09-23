/**
 * /spend — spend + limits route: thin Suspense wrapper around the spend
 * plugin's page slot (same shape as /models).
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function SpendPage() {
  return (
    <Suspense>
      <Slot name="page:/spend" />
    </Suspense>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/spend',
  component: SpendPage,
})
