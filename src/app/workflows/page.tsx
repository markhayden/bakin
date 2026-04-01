'use client'

import { Suspense } from 'react'
import { WorkflowsPage } from '@bakin/workflows/components/workflows-page'

export default function WorkflowsRoute() {
  return (
    <Suspense>
      <WorkflowsPage />
    </Suspense>
  )
}
