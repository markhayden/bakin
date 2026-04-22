/**
 * /messaging — redirect to /messaging/calendar.
 *
 * Mirrors `src/app/messaging/page.tsx`. Uses `beforeLoad` so the
 * redirect happens before TanStack attempts to render anything — no
 * flash of an empty messaging shell. The index route sits alongside
 * the calendar/brainstorm leaves via a trailing-slash path.
 */
import { createRoute, redirect } from '@tanstack/react-router'
import { Route as RootRoute } from './__root'

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/messaging/',
  beforeLoad: () => {
    throw redirect({ to: '/messaging/calendar' })
  },
})
