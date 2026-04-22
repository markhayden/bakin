/**
 * /projects/$id/edit — project edit route.
 *
 * Mirrors `src/app/projects/[id]/edit/page.tsx`: boots the slot in
 * edit mode, exits back to the detail view via `replace: true` so the
 * edit URL doesn't clutter browser history. `onBack` goes to the list
 * to match the Next.js behavior.
 */
import { createRoute, useNavigate } from '@tanstack/react-router'
import { Slot } from '@bakin/sdk/slots'
import { Route as RootRoute } from './__root'

function ProjectEditPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()

  return (
    <div className="p-6 flex flex-col h-full min-h-0">
      <Slot
        name="page:/projects/[id]/edit"
        projectId={id}
        onBack={() => navigate({ to: '/projects' })}
        initialEdit
        onEditChange={(editing: boolean) => {
          if (!editing) navigate({ to: '/projects/$id', params: { id }, replace: true })
        }}
      />
    </div>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/projects/$id/edit',
  component: ProjectEditPage,
})
