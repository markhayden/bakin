/**
 * /messaging/calendar — content calendar route.
 *
 * Mirrors `src/app/messaging/calendar/page.tsx`. The messaging plugin
 * has both calendar and brainstorm views; this is the default landing
 * (see the /messaging redirect route).
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@bakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function MessagingCalendarPage() {
  return (
    <div className="p-6 flex flex-col flex-1">
      <Suspense>
        <Slot name="page:/messaging/calendar" />
      </Suspense>
    </div>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/messaging/calendar',
  component: MessagingCalendarPage,
})
