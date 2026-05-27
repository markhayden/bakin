/**
 * /workflows/new — workflow canvas "create" route.
 *
 * Mirrors `src/app/workflows/new/page.tsx`. The workflows plugin's
 * canvas editor handles saved/cancel lifecycle via callbacks; we
 * navigate to the new workflow's editor on save, back to the
 * list on cancel.
 */
import { createRoute, useNavigate } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Route as RootRoute } from './__root'

function WorkflowsNewPage() {
  const navigate = useNavigate()
  return (
    <Slot
      name="page:/workflows/new"
      mode="create"
      onSaved={(savedId: string) => navigate({ to: '/workflows/$id/edit', params: { id: savedId } })}
      onCancel={() => navigate({ to: '/workflows' })}
    />
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/workflows/new',
  component: WorkflowsNewPage,
})
