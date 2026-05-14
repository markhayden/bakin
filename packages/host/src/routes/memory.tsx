/**
 * /memory — memory observability dashboard route.
 *
 * Mirrors `src/app/memory/page.tsx`: the source doesn't wrap the slot
 * in Suspense (the memory plugin handles loading states internally),
 * so the route body is just the slot.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Route as RootRoute } from './__root'

function MemoryPage() {
  return <Slot name="page:/memory" />
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/memory',
  component: MemoryPage,
})
