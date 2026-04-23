/**
 * /messaging/brainstorm — brainstorm planning route.
 *
 * Mirrors `src/app/messaging/brainstorm/page.tsx`. Same flex-column
 * wrapper as the calendar view.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@bakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function MessagingBrainstormPage() {
  return (
    <div className="p-6 flex flex-col flex-1">
      <Suspense>
        <Slot name="page:/messaging/brainstorm" />
      </Suspense>
    </div>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/messaging/brainstorm',
  component: MessagingBrainstormPage,
})
