/**
 * Router instance for the Bakin host.
 *
 * Route tree is assembled here; each route module exports its `Route`
 * definition and we wire them via `addChildren`. TC4-TC24 (per the #147
 * plan) add more leaves under the root.
 */
import { createRouter } from '@tanstack/react-router'
import { NotFoundPage } from './components/not-found'
import { parseSearchPlain, stringifySearchPlain } from './lib/search-params'
import { Route as RootRoute } from './routes/__root'
import { Route as IndexRoute } from './routes/index'
import { Route as TasksRoute } from './routes/tasks'
import { Route as TeamIndexRoute } from './routes/team.index'
import { Route as TeamIdRoute } from './routes/team.$id'
import { Route as TeamTeamsRoute } from './routes/team.teams.$teamId'
import { Route as WorkflowsIndexRoute } from './routes/workflows.index'
import { Route as WorkflowsNewRoute } from './routes/workflows.new'
import { Route as WorkflowsIdIndexRoute } from './routes/workflows.$id.index'
import { Route as WorkflowsIdEditRoute } from './routes/workflows.$id.edit'
import { Route as AssetsRoute } from './routes/assets'
import { Route as AssetDetailRoute } from './routes/assets.$assetId'
import { Route as BrandsRoute } from './routes/brands'
import { Route as BrandDetailRoute } from './routes/brands.$brandId'
import { Route as BrandDocEditorRoute } from './routes/brands.$brandId.docs.$kind.$name'
import { Route as ChatRoute } from './routes/chat'
import { Route as ChatNewRoute } from './routes/chat.new'
import { Route as ChatDetailRoute } from './routes/chat.$chatId'
import { Route as ExploreRoute } from './routes/explore'
import { Route as HealthRoute } from './routes/health'
import { Route as MemoryRoute } from './routes/memory'
import { Route as ModelsRoute } from './routes/models'
import { Route as ScheduleRoute } from './routes/schedule'
import { Route as SettingsRoute } from './routes/settings'
import { Route as RuntimeRoute } from './routes/runtime'
import { Route as PluginCatchAllRoute } from './routes/plugin-catchall'

const routeTree = RootRoute.addChildren([
  IndexRoute,
  TasksRoute,
  TeamIndexRoute,
  TeamTeamsRoute,
  TeamIdRoute,
  WorkflowsIndexRoute,
  WorkflowsNewRoute,
  WorkflowsIdIndexRoute,
  WorkflowsIdEditRoute,
  AssetsRoute,
  AssetDetailRoute,
  BrandsRoute,
  BrandDetailRoute,
  BrandDocEditorRoute,
  ChatRoute,
  ChatNewRoute,
  ChatDetailRoute,
  ExploreRoute,
  HealthRoute,
  MemoryRoute,
  ModelsRoute,
  ScheduleRoute,
  SettingsRoute,
  RuntimeRoute,
  PluginCatchAllRoute,
])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  // Every query value is an opaque string — never JSON-coerced (PR3 3.1;
  // see packages/host/src/lib/search-params.ts for why).
  parseSearch: parseSearchPlain,
  stringifySearch: stringifySearchPlain,
  // Back/forward restores scroll (PR3 3.3). The shell scrolls in an inner
  // div, not the window — layout-shell marks it with
  // data-scroll-restoration-id so the cache tracks it by selector.
  scrollRestoration: true,
  // Unknown paths normally land in the `$` catch-all (which renders
  // NotFoundPage when no plugin claims them); this is the backstop for
  // notFound() thrown inside routes.
  defaultNotFoundComponent: NotFoundPage,
})

// Register the router instance for type safety across the app.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
