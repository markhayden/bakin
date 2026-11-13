/**
 * /home — the Home page.
 *
 * Thin Suspense wrapper around the home plugin's slot. `/` still opens the
 * task board until every Home state has a screen (home-first-run plan,
 * PR 3 switches it).
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function HomePage() {
  return (
    <Suspense>
      <Slot name="page:/home" />
    </Suspense>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/home',
  component: HomePage,
})
