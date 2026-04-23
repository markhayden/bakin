/**
 * /health — system health dashboard route.
 *
 * Mirrors `src/app/health/page.tsx`: thin Suspense wrapper around the
 * health plugin's slot.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@bakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function HealthPage() {
  return (
    <Suspense>
      <Slot name="page:/health" />
    </Suspense>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/health',
  component: HealthPage,
})
