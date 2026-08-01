/**
 * /tasks — task board route.
 *
 * Mirrors `src/app/tasks/page.tsx`: renders the `page:/tasks` slot that
 * the tasks plugin fills with the kanban board. The plugin-owned page recipe
 * supplies its own canonical canvas and responsive spacing.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function TasksPage() {
  return (
    <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
      <Suspense>
        <Slot name="page:/tasks" />
      </Suspense>
    </div>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/tasks',
  component: TasksPage,
})
