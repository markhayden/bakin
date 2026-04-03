'use client'

import { Suspense } from 'react'
import { ModelsPage } from '@bakin/models/components/models-page'

export default function Page() {
  return (
    <Suspense>
      <ModelsPage />
    </Suspense>
  )
}
