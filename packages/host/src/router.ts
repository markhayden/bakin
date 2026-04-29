/**
 * Router instance for the Bakin host.
 *
 * Route tree is assembled here; each route module exports its `Route`
 * definition and we wire them via `addChildren`. TC4-TC24 (per the #147
 * plan) add more leaves under the root.
 */
import { createRouter } from '@tanstack/react-router'
import { Route as RootRoute } from './routes/__root'
import { Route as IndexRoute } from './routes/index'
import { Route as TasksRoute } from './routes/tasks'
import { Route as TeamIndexRoute } from './routes/team.index'
import { Route as TeamIdRoute } from './routes/team.$id'
import { Route as ProjectsIndexRoute } from './routes/projects.index'
import { Route as ProjectsNewRoute } from './routes/projects.new'
import { Route as ProjectsIdIndexRoute } from './routes/projects.$id.index'
import { Route as ProjectsIdEditRoute } from './routes/projects.$id.edit'
import { Route as WorkflowsIndexRoute } from './routes/workflows.index'
import { Route as WorkflowsNewRoute } from './routes/workflows.new'
import { Route as WorkflowsIdIndexRoute } from './routes/workflows.$id.index'
import { Route as WorkflowsIdEditRoute } from './routes/workflows.$id.edit'
import { Route as AssetsRoute } from './routes/assets'
import { Route as HealthRoute } from './routes/health'
import { Route as MemoryRoute } from './routes/memory'
import { Route as MessagingIndexRoute } from './routes/messaging.index'
import { Route as MessagingCalendarRoute } from './routes/messaging.calendar'
import { Route as MessagingBrainstormRoute } from './routes/messaging.brainstorm'
import { Route as ModelsRoute } from './routes/models'
import { Route as ScheduleRoute } from './routes/schedule'
import { Route as SettingsRoute } from './routes/settings'
import { Route as PluginCatchAllRoute } from './routes/plugin-catchall'

const routeTree = RootRoute.addChildren([
  IndexRoute,
  TasksRoute,
  TeamIndexRoute,
  TeamIdRoute,
  ProjectsIndexRoute,
  ProjectsNewRoute,
  ProjectsIdIndexRoute,
  ProjectsIdEditRoute,
  WorkflowsIndexRoute,
  WorkflowsNewRoute,
  WorkflowsIdIndexRoute,
  WorkflowsIdEditRoute,
  AssetsRoute,
  HealthRoute,
  MemoryRoute,
  MessagingIndexRoute,
  MessagingCalendarRoute,
  MessagingBrainstormRoute,
  ModelsRoute,
  ScheduleRoute,
  SettingsRoute,
  PluginCatchAllRoute,
])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

// Register the router instance for type safety across the app.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
