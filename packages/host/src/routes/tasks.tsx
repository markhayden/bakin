/**
 * /tasks — task board route.
 *
 * Mirrors `src/app/tasks/page.tsx`: renders the `page:/tasks` slot that
 * the tasks plugin fills with the kanban board. Layout wrapper div keeps
 * the original `p-[5px]` padding so the board hugs the viewport edges.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function TasksPage() {
  return (
    <div className="p-[5px] flex flex-col h-full min-w-0 overflow-hidden">
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
