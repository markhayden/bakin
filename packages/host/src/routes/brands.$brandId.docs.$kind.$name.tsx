/**
 * /brands/$brandId/docs/$kind/$name — dedicated brand doc editor route
 * (guidelines + lessons). The brands plugin owns the page via the
 * `page:/brands/:brandId/docs` slot; the wrapper is just <Suspense>. The slot
 * component reads $brandId/$kind/$name from the route params (workflows
 * $id.edit precedent: full-width editor page, deep-linkable).
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function BrandDocEditorPage() {
  return (
    <Suspense>
      <Slot name="page:/brands/:brandId/docs" />
    </Suspense>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/brands/$brandId/docs/$kind/$name',
  component: BrandDocEditorPage,
})
