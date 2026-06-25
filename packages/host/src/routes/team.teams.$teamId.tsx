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
    <div className="p-6 flex flex-col h-full min-h-0">
      <Suspense fallback={null}>
        <Slot name="page:/team/teams/[teamId]" teamId={teamId} />
      </Suspense>
    </div>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/team/teams/$teamId',
  component: TeamDetailPage,
})
