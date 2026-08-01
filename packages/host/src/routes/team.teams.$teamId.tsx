/**
 * /team/teams/$teamId — team detail route (layered-context spec, C11).
 *
 * Static `teams` segment outranks the `/team/$id` agent-detail param route
 * in TanStack matching, so team pages never collide with agent ids. The
 * pseudo-team id `global` renders the global context page.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function TeamDetailPage() {
  const { teamId } = Route.useParams()
  return (
    <Suspense fallback={null}>
      <Slot name="page:/team/teams/[teamId]" teamId={teamId} />
    </Suspense>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/team/teams/$teamId',
  component: TeamDetailPage,
})
