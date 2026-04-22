/**
 * /projects/new — create-project route.
 *
 * Mirrors `src/app/projects/new/page.tsx`: renders the project detail
 * slot in "new/edit" mode. Closing the edit panel (or completing the
 * create) navigates back to `/projects` through TanStack's `useNavigate`
 * — replacing the Next.js `router.push(...)` calls.
 */
import { createRoute, useNavigate } from '@tanstack/react-router'
import { Slot } from '@bakin/sdk/slots'
import { Route as RootRoute } from './__root'

function ProjectsNewPage() {
  const navigate = useNavigate()

  return (
    <div className="p-6 flex flex-col h-full min-h-0">
      <Slot
        name="page:/projects/new"
        onBack={() => navigate({ to: '/projects' })}
        initialEdit
        onEditChange={(editing: boolean) => {
          if (!editing) navigate({ to: '/projects' })
        }}
      />
    </div>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/projects/new',
  component: ProjectsNewPage,
})
