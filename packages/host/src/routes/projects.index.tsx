/**
 * /projects — project list route.
 *
 * Mirrors `src/app/projects/page.tsx`. Uses the trailing-slash path
 * form so it matches only the list page; /projects/new and
 * /projects/$id live alongside in sibling route files.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@bakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function ProjectsIndexPage() {
  return (
    <div className="p-[5px] flex flex-col h-full min-w-0 overflow-hidden">
      <Suspense>
        <Slot name="page:/projects" />
      </Suspense>
    </div>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/projects/',
  component: ProjectsIndexPage,
})
