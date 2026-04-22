/**
 * /projects/$id — project detail route.
 *
 * Mirrors `src/app/projects/[id]/page.tsx`. Path ends with `/` so the
 * router prefers the nested `/projects/$id/edit` leaf when the user
 * transitions into edit mode. `navigate({ replace: true })` replaces
 * the Next.js `router.replace(..., { scroll: false })` — TanStack has
 * no scroll opt-out but the default already preserves scroll on replace.
 */
import { createRoute, useNavigate } from '@tanstack/react-router'
import { Slot } from '@bakin/sdk/slots'
import { Route as RootRoute } from './__root'

function ProjectDetailPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()

  return (
    <div className="p-6 flex flex-col h-full min-h-0">
      <Slot
        name="page:/projects/[id]"
        projectId={id}
        onBack={() => navigate({ to: '/projects' })}
        onEditChange={(editing: boolean) => {
          if (editing) navigate({ to: '/projects/$id/edit', params: { id }, replace: true })
        }}
      />
    </div>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/projects/$id/',
  component: ProjectDetailPage,
})
