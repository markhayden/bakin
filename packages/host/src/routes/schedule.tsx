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
  // Height-bound route wrapper: the schedule page is an immersive
  // WorkspacePage whose shell owns the page scroll — the shell's h-full
  // needs this definite-height chain from the route.
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
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
