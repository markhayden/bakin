/**
 * /workflows/$id — workflow detail route.
 *
 * Mirrors `src/app/workflows/[id]/page.tsx`. Trailing-slash path keeps
 * this separate from `/workflows/$id/edit`. Back navigates to the
 * workflows grid.
 */
import { createRoute, useNavigate } from '@tanstack/react-router'
import { Slot } from '@bakin/sdk/slots'
import { Route as RootRoute } from './__root'

function WorkflowDetailPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()

  return (
    <Slot
      name="page:/workflows/[id]"
      workflowId={id}
      onBack={() => navigate({ to: '/workflows' })}
    />
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/workflows/$id/',
  component: WorkflowDetailPage,
})
