/**
 * `/` is Home: the page Bakin opens on.
 *
 * Thin Suspense wrapper around the home plugin's slot. The slot keeps the
 * name it was registered under (`page:/home`); `/home` itself redirects
 * here, so the page has one URL.
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
  path: '/',
  component: HomePage,
})
