/**
 * /schedule — cron job manager route.
 *
 * Mirrors the tasks route: a bare flex shell — the plugin-owned page
 * recipe supplies its own canonical canvas and responsive spacing.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function SchedulePage() {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <Suspense>
        <Slot name="page:/schedule" />
      </Suspense>
    </div>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/schedule',
  component: SchedulePage,
})
