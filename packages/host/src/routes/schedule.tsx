/**
 * /schedule — cron job manager route.
 *
 * Mirrors `src/app/schedule/page.tsx`: same `p-[5px]` edge-hugging
 * padding as the tasks route.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function SchedulePage() {
  return (
    <div className="p-[5px] flex flex-col h-full min-w-0 overflow-hidden">
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
