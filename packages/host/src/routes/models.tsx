/**
 * /models — model configuration route.
 *
 * Mirrors `src/app/models/page.tsx`: thin Suspense wrapper around the
 * models plugin's slot.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function ModelsPage() {
  return (
    <Suspense>
      <Slot name="page:/models" />
    </Suspense>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/models',
  component: ModelsPage,
})
