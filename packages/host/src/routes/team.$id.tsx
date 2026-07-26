/**
 * /team/$id — agent detail route.
 *
 * Mirrors `src/app/team/[id]/page.tsx`: resolves the path param via
 * TanStack's `Route.useParams()` (synchronous — no more `use(Promise)`
 * juggling the Next.js 16 async-params API required) and hands it to
 * the `page:/team/[id]` slot as `agentId`.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function TeamDetailPage() {
  const { id } = Route.useParams()
  return (
    <Suspense fallback={null}>
      <Slot name="page:/team/[id]" agentId={id} />
    </Suspense>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/team/$id',
  component: TeamDetailPage,
})
