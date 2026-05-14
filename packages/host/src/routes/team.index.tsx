/**
 * /team — agent team grid route.
 *
 * Mirrors `src/app/team/page.tsx`: renders the `page:/team` slot (filled
 * by the team plugin) inside the same flex column wrapper. Named
 * `team.index.tsx` so the flat route file naming leaves room for the
 * `/team/$id` detail route alongside it.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function TeamIndexPage() {
  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      <Suspense>
        <Slot name="page:/team" />
      </Suspense>
    </div>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/team/',
  component: TeamIndexPage,
})
