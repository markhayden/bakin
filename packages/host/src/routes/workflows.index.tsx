/**
 * /workflows — workflow template grid route.
 *
 * Mirrors `src/app/workflows/page.tsx` — the workflows plugin handles
 * its own padding internally, so the route just wraps in Suspense and
 * delegates to the slot.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function WorkflowsIndexPage() {
  return (
    <Suspense>
      <Slot name="page:/workflows" />
    </Suspense>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/workflows/',
  component: WorkflowsIndexPage,
})
